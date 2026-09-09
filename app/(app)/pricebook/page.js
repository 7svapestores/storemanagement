'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Alert, Loading, EmptyState, ConfirmModal, Field, Modal } from '@/components/UI';
import BarcodeScanModal from '@/components/BarcodeScanner';
import MultiStorePanel from '@/components/pricebook/MultiStorePanel';
import CatalogPanel from '@/components/pricebook/CatalogPanel';

const fmtCents = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
// "29.99" / "$29.99" / "2999¢"? → integer cents. Returns null if unparseable.
const dollarsToCents = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export default function PricebookPage() {
  const { supabase, isOwner } = useAuth();
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [loadingStores, setLoadingStores] = useState(true);
  const [tab, setTab] = useState('update'); // 'update' | 'multi' | 'catalog' | 'add'

  // pending edits: upc -> { item, newCents }
  const [pending, setPending] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('stores').select('id, name, nrs_store_id').order('created_at');
      const nrs = (data || []).filter(s => s.nrs_store_id);
      setStores(nrs);
      if (nrs.length) setStoreId(nrs[0].id);
      setLoadingStores(false);
    })();
  }, [supabase]);

  // Changing store clears the basket to avoid cross-store mixups.
  const onStoreChange = (id) => {
    setStoreId(id);
    setPending({});
    setApplyResult(null);
  };

  const stageEdit = useCallback((item, dollars) => {
    const newCents = dollarsToCents(dollars);
    setPending((prev) => {
      const next = { ...prev };
      if (newCents == null || newCents === item.cents) {
        delete next[item.upc];
      } else {
        next[item.upc] = { item, newCents };
      }
      return next;
    });
  }, []);

  const removePending = (upc) => setPending((prev) => {
    const next = { ...prev }; delete next[upc]; return next;
  });

  const pendingList = Object.values(pending);

  const applyUpdates = async () => {
    setConfirmOpen(false);
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch('/api/pricebook/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          updates: pendingList.map(p => ({ upc: p.item.upc, cents: p.newCents })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setApplyResult(json);
      // Clear successfully-updated items from the basket.
      const failedUpcs = new Set((json.results || []).filter(r => !r.ok).map(r => r.upc));
      setPending((prev) => {
        const next = {};
        for (const [upc, v] of Object.entries(prev)) if (failedUpcs.has(upc)) next[upc] = v;
        return next;
      });
    } catch (e) {
      setApplyResult({ error: e.message });
    } finally {
      setApplying(false);
    }
  };

  if (!isOwner) return <Alert type="warning">Owner only.</Alert>;
  if (loadingStores) return <Loading />;
  if (!stores.length) return <Alert type="warning">No stores with an NRS ID configured.</Alert>;

  return (
    <div className="py-4 md:py-6 max-w-[1200px]">
      <PageHeader
        title="Pricebook"
        subtitle="Change prices in one store or across all of them, or add a brand-new item. Changes are written straight to your POS."
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-sw-border">
        {[['update', 'One store'], ['multi', 'All stores'], ['catalog', 'By UPC'], ['add', 'Add new item']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === key ? 'border-amber-500 text-sw-text' : 'border-transparent text-[var(--text-muted)] hover:text-sw-text'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'update' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-[12px] font-semibold text-[var(--text-muted)]">Store</span>
            <select
              value={storeId}
              onChange={(e) => onStoreChange(e.target.value)}
              className="rounded-lg border border-sw-border bg-sw-card px-3 py-1.5 text-[13px] text-sw-text"
            >
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <SearchPanel storeId={storeId} stores={stores} pending={pending} onStage={stageEdit} />
            <ReviewPanel
              pendingList={pendingList}
              onRemove={removePending}
              onApply={() => setConfirmOpen(true)}
              applying={applying}
              result={applyResult}
            />
          </div>
        </>
      )}

      {tab === 'multi' && <MultiStorePanel />}

      {tab === 'catalog' && <CatalogPanel />}

      {tab === 'add' && <AddItemPanel stores={stores} />}

      {confirmOpen && (
        <ConfirmModal
          title="Apply price changes?"
          message={`This will update ${pendingList.length} item price${pendingList.length === 1 ? '' : 's'} in your live NRS pricebook. This takes effect immediately at the register.`}
          confirmLabel="Update prices"
          confirmVariant="primary"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={applyUpdates}
        />
      )}
    </div>
  );
}

// ── Search + results with inline price editing ──────────────────────────
function SearchPanel({ storeId, stores, pending, onStage }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [copyItem, setCopyItem] = useState(null); // item being cloned to other stores
  const [scanOpen, setScanOpen] = useState(false);
  const reqRef = useRef(0);

  const [total, setTotal] = useState(0);       // recordsFiltered for the query
  const [loadingMore, setLoadingMore] = useState(false);

  // Per-row editable text for the price box. Seeded from any staged change,
  // else the item's current price. Lets manual typing AND the bulk-set bar
  // both reflect in the inputs.
  const [draft, setDraft] = useState({}); // upc -> string
  const [selected, setSelected] = useState(() => new Set()); // upc set
  const [bulkPrice, setBulkPrice] = useState('');

  // View controls: sort order + filter to a single current price.
  const [sort, setSort] = useState('name'); // 'name' | 'price_asc' | 'price_desc'
  const [priceFilter, setPriceFilter] = useState(null); // cents | null

  const PAGE = 100;

  // Distinct current prices among loaded items, with counts — rendered as
  // clickable filter chips so a whole price group is one click to isolate.
  const priceChips = useMemo(() => {
    const counts = new Map();
    for (const it of items) counts.set(it.cents, (counts.get(it.cents) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([cents, count]) => ({ cents, count }));
  }, [items]);

  // The rows actually shown: filtered by chip, then sorted.
  const visible = useMemo(() => {
    let v = priceFilter == null ? items : items.filter(it => it.cents === priceFilter);
    const byName = (a, b) => (a.name || a.desc || '').localeCompare(b.name || b.desc || '');
    if (sort === 'price_asc') v = [...v].sort((a, b) => a.cents - b.cents || byName(a, b));
    else if (sort === 'price_desc') v = [...v].sort((a, b) => b.cents - a.cents || byName(a, b));
    else v = [...v].sort(byName);
    return v;
  }, [items, priceFilter, sort]);

  // Seed draft entries for rows that don't have one yet (keeps existing edits
  // and selection intact when appending more pages).
  const seedDrafts = useCallback((rows) => {
    setDraft((d) => {
      const next = { ...d };
      for (const it of rows) {
        if (next[it.upc] === undefined) {
          next[it.upc] = pending[it.upc]
            ? (pending[it.upc].newCents / 100).toFixed(2)
            : (it.cents / 100).toFixed(2);
        }
      }
      return next;
    });
  }, [pending]);

  const fetchPage = useCallback(async (term, start) => {
    const params = new URLSearchParams({ store_id: storeId, q: term, start: String(start), length: String(PAGE) });
    const res = await fetch(`/api/pricebook/search?${params}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Search failed');
    return { items: json.items || [], total: json.recordsFiltered ?? 0 };
  }, [storeId]);

  const editPrice = (it, value) => {
    setDraft((d) => ({ ...d, [it.upc]: value }));
    onStage(it, value);
  };

  const toggleRow = (upc) => setSelected((s) => {
    const n = new Set(s); n.has(upc) ? n.delete(upc) : n.add(upc); return n;
  });
  // Select-all targets the currently visible (filtered) rows, so "filter to
  // $27.49 → select all" only grabs that group.
  const allSelected = visible.length > 0 && visible.every(i => selected.has(i.upc));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allSelected) visible.forEach(i => n.delete(i.upc));
    else visible.forEach(i => n.add(i.upc));
    return n;
  });

  // Apply the bulk price to every selected row at once (stages, not applied).
  const applyBulk = () => {
    if (!bulkPrice.trim() || selected.size === 0) return;
    const val = (parseFloat(bulkPrice.replace(/[^0-9.]/g, '')) || 0).toFixed(2);
    setDraft((d) => {
      const next = { ...d };
      for (const it of items) {
        if (selected.has(it.upc)) { next[it.upc] = val; onStage(it, val); }
      }
      return next;
    });
  };

  // Fresh search — resets the list, selection stays cleared.
  const runSearch = useCallback(async (term) => {
    const myReq = ++reqRef.current;
    setLoading(true); setError('');
    try {
      const { items: rows, total: t } = await fetchPage(term, 0);
      if (myReq !== reqRef.current) return;
      setItems(rows); setTotal(t); setSearched(true);
      setSelected(new Set()); setDraft({});
      seedDrafts(rows);
    } catch (e) {
      if (myReq === reqRef.current) setError(e.message);
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, [fetchPage, seedDrafts]);

  // Append the next page (or keep going until everything is loaded).
  const loadMore = useCallback(async (all = false) => {
    const myReq = reqRef.current;
    setLoadingMore(true); setError('');
    try {
      let start = items.length;
      let acc = [];
      do {
        const { items: rows, total: t } = await fetchPage(q.trim(), start);
        if (myReq !== reqRef.current) return; // a new search superseded us
        acc = acc.concat(rows);
        setTotal(t);
        start += rows.length;
        if (rows.length === 0) break;
        if (!all) break;
        if (start >= t || start >= 2000) break; // hard safety cap
      } while (true);
      if (myReq !== reqRef.current) return;
      setItems((prev) => [...prev, ...acc]);
      seedDrafts(acc);
    } catch (e) {
      if (myReq === reqRef.current) setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, q, fetchPage, seedDrafts]);

  // Debounced search as the owner types.
  useEffect(() => {
    if (!storeId) return;
    const t = setTimeout(() => runSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q, storeId, runSearch]);

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4">
      <div className="flex gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or UPC…"
          className="flex-1 min-w-0 rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text"
        />
        <Button variant="secondary" onClick={() => setScanOpen(true)} title="Scan a barcode to find the item">📷 Scan</Button>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {loading && <Loading text="Searching pricebook…" />}
      {!loading && searched && items.length === 0 && (
        <EmptyState icon="🔍" title="No items found" message="Try a different name or UPC." />
      )}

      {!loading && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-[12px] text-[var(--text-muted)]">
            Showing <span className="text-sw-text font-semibold">{visible.length}</span>
            {priceFilter != null ? ` of ${items.length} loaded` : ` of ${total} matching`} item{visible.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)]">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-md border border-sw-border bg-sw-bg px-2 py-1 text-[12px] text-sw-text"
            >
              <option value="name">Name</option>
              <option value="price_asc">Price: low → high</option>
              <option value="price_desc">Price: high → low</option>
            </select>
          </div>
        </div>
      )}

      {/* Price filter chips — click a current price to isolate that group. */}
      {!loading && priceChips.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setPriceFilter(null)}
            className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${priceFilter == null ? 'bg-amber-500/15 border-amber-500/50 text-sw-text' : 'border-sw-border text-[var(--text-muted)] hover:text-sw-text'}`}
          >
            All ({items.length})
          </button>
          {priceChips.map(({ cents, count }) => (
            <button
              key={cents}
              onClick={() => setPriceFilter(priceFilter === cents ? null : cents)}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${priceFilter === cents ? 'bg-amber-500/15 border-amber-500/50 text-sw-text' : 'border-sw-border text-[var(--text-muted)] hover:text-sw-text'}`}
            >
              {fmtCents(cents)} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Bulk-set bar: appears once rows are selected. */}
      {!loading && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
          <span className="text-[12px] font-semibold text-sw-text">{selected.size} selected</span>
          <span className="text-[12px] text-[var(--text-muted)]">→ set all to</span>
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-muted)]">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyBulk(); }}
              placeholder="27.49"
              style={{ width: '5rem' }} className="w-20 rounded-md border border-sw-border bg-sw-bg px-2 py-1 text-[13px] text-sw-text"
            />
          </div>
          <Button variant="primary" onClick={applyBulk} disabled={!bulkPrice.trim()}>Apply to selected</Button>
          <button onClick={() => setSelected(new Set())} className="text-[12px] text-[var(--text-muted)] hover:text-sw-text underline">Clear</button>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div>
          {/* Select-all header (replaces a table header so it works on mobile). */}
          <label className="flex items-center gap-2 py-2 border-b border-sw-border text-[12px] font-semibold text-[var(--text-muted)] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 shrink-0 accent-amber-500" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            Select all ({visible.length})
          </label>

          <ul>
            {visible.map((it) => {
              const staged = pending[it.upc];
              const checked = selected.has(it.upc);
              return (
                <li key={it.upc} className={`flex items-center gap-3 py-2.5 border-b border-sw-border/50 ${checked ? 'bg-amber-500/5' : ''}`}>
                  <input type="checkbox" className="w-4 h-4 shrink-0 accent-amber-500" checked={checked} onChange={() => toggleRow(it.upc)} aria-label={`Select ${it.name || it.upc}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sw-text truncate">{it.name || it.desc || '—'}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{it.upc}{it.dept ? ` · ${it.dept}` : ''}</div>
                    {stores?.length > 1 && (
                      <button onClick={() => setCopyItem(it)} className="text-[11px] text-amber-500 hover:underline mt-0.5">
                        Copy to other stores →
                      </button>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] text-[var(--text-muted)] mb-0.5">was {fmtCents(it.cents)}</div>
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-[var(--text-muted)]">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft[it.upc] ?? (it.cents / 100).toFixed(2)}
                        onChange={(e) => editPrice(it, e.target.value)}
                        style={{ width: '4.75rem' }} className={`w-[72px] rounded-md border bg-sw-bg px-2 py-1.5 text-[13px] text-sw-text ${staged ? 'border-amber-500' : 'border-sw-border'}`}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {items.length < total && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button variant="secondary" onClick={() => loadMore(false)} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load more (${total - items.length} left)`}
              </Button>
              <Button variant="secondary" onClick={() => loadMore(true)} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load all ${total}`}
              </Button>
            </div>
          )}
        </div>
      )}

      {copyItem && (
        <CopyToStoresModal item={copyItem} sourceStoreId={storeId} stores={stores} onClose={() => setCopyItem(null)} />
      )}

      {scanOpen && (
        <BarcodeScanModal
          onDetected={(code) => { setQ(code); setScanOpen(false); }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  );
}

// ── Clone an existing item into other stores ────────────────────────────
function CopyToStoresModal({ item, sourceStoreId, stores, onClose }) {
  const sourcePrice = (item.cents / 100).toFixed(2);
  const [rows, setRows] = useState(() =>
    stores.filter(s => s.id !== sourceStoreId).map(s => ({ id: s.id, name: s.name, selected: true, price: sourcePrice }))
  );
  const [bulkPrice, setBulkPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const applyBulk = () => {
    if (!bulkPrice.trim()) return;
    const v = (parseFloat(bulkPrice.replace(/[^0-9.]/g, '')) || 0).toFixed(2);
    setRows(rs => rs.map(r => r.selected ? { ...r, price: v } : r));
  };

  const selectedRows = rows.filter(r => r.selected);
  const canSubmit = selectedRows.length > 0 && selectedRows.every(r => r.price.trim() && Number(r.price) >= 0);

  const submit = async () => {
    setSubmitting(true); setResult(null);
    try {
      const targets = selectedRows.map(r => ({ store_id: r.id, cents: Math.round(parseFloat(r.price) * 100) }));
      const res = await fetch('/api/pricebook/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { upc: item.upc, name: item.name, size: item.size || '', dept: item.dept, costCents: item.cost_cents || 0 },
          targets,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Copy failed');
      setResult(json);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Copy "${item.name || item.upc}" to other stores`} onClose={onClose}>
      <p className="text-sw-sub text-[12px] mb-3">
        Clones this item ({item.upc}{item.dept ? ` · ${item.dept}` : ''}) into the selected stores. Price prefilled from the source — adjust per store if needed.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[var(--text-muted)] text-[13px]">$</span>
        <input value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} inputMode="decimal" placeholder="set all to"
          onKeyDown={e => { if (e.key === 'Enter') applyBulk(); }}
          style={{ width: '6rem' }} className="w-24 rounded-md border border-sw-border bg-sw-bg px-2 py-1 text-[13px] text-sw-text" />
        <Button variant="secondary" onClick={applyBulk} disabled={!bulkPrice.trim()}>Set all</Button>
      </div>

      <ul className="space-y-2 mb-4 max-h-[280px] overflow-y-auto">
        {rows.map(r => (
          <li key={r.id} className="flex items-center gap-2">
            <input type="checkbox" className="w-4 h-4 shrink-0 accent-amber-500" checked={r.selected} onChange={e => setRow(r.id, { selected: e.target.checked })} />
            <span className="flex-1 min-w-0 truncate text-[13px] text-sw-text" title={r.name}>{r.name || r.id}</span>
            <span className="text-[var(--text-muted)] text-[13px]">$</span>
            <input value={r.price} onChange={e => setRow(r.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00"
              disabled={!r.selected}
              style={{ width: '5rem' }} className={`w-20 rounded-md border bg-sw-bg px-2 py-1 text-[13px] text-sw-text ${r.selected ? 'border-sw-border' : 'border-sw-border/40 opacity-50'}`} />
          </li>
        ))}
      </ul>

      {result ? (
        result.error
          ? <Alert type="error">{result.error}</Alert>
          : <Alert type={result.failed ? 'warning' : 'success'}>
              Copied to {result.created} store{result.created === 1 ? '' : 's'}{result.failed ? `, ${result.failed} failed` : ''}.
              {result.failed > 0 && (
                <ul className="mt-2 text-[12px] list-disc pl-4">
                  {result.results.filter(r => !r.ok).map(r => <li key={r.store_id}>{r.store}: {r.error}</li>)}
                </ul>
              )}
            </Alert>
      ) : null}

      <div className="flex gap-2 justify-end mt-4">
        <Button variant="secondary" onClick={onClose}>{result && !result.error ? 'Close' : 'Cancel'}</Button>
        {!(result && !result.error) && (
          <Button variant="primary" disabled={!canSubmit || submitting} onClick={submit}>
            {submitting ? 'Copying…' : `Copy to ${selectedRows.length || ''} store${selectedRows.length === 1 ? '' : 's'}`.trim()}
          </Button>
        )}
      </div>
    </Modal>
  );
}

// ── Basket of staged changes + apply ────────────────────────────────────
function ReviewPanel({ pendingList, onRemove, onApply, applying, result }) {
  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4 h-fit lg:sticky lg:top-4">
      <h3 className="text-sw-text text-[15px] font-bold mb-1">Pending changes</h3>
      <p className="text-sw-sub text-[12px] mb-3">Review before applying. Nothing is sent until you click Update.</p>

      {pendingList.length === 0 ? (
        <div className="text-[13px] text-[var(--text-muted)] py-6 text-center">
          Edit a price in the list to stage a change.
        </div>
      ) : (
        <ul className="space-y-2 mb-4">
          {pendingList.map(({ item, newCents }) => (
            <li key={item.upc} className="flex items-center justify-between gap-2 text-[13px]">
              <div className="min-w-0">
                <div className="font-medium text-sw-text truncate">{item.name || item.desc || item.upc}</div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {fmtCents(item.cents)} → <span className="text-amber-500 font-semibold">{fmtCents(newCents)}</span>
                </div>
              </div>
              <button onClick={() => onRemove(item.upc)} className="text-[var(--text-muted)] hover:text-red-500 text-[16px] leading-none">×</button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="primary"
        className="w-full"
        disabled={pendingList.length === 0 || applying}
        onClick={onApply}
      >
        {applying ? 'Updating…' : `Update ${pendingList.length || ''} price${pendingList.length === 1 ? '' : 's'}`.trim()}
      </Button>

      {result && (
        <div className="mt-4">
          {result.error ? (
            <Alert type="error">{result.error}</Alert>
          ) : (
            <Alert type={result.failed ? 'warning' : 'success'}>
              Updated {result.updated} price{result.updated === 1 ? '' : 's'}
              {result.failed ? `, ${result.failed} failed` : ''}.
              {result.failed > 0 && (
                <ul className="mt-2 text-[12px] list-disc pl-4">
                  {result.results.filter(r => !r.ok).map(r => (
                    <li key={r.upc}>{r.upc}: {r.error}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add a new item to one or more stores ────────────────────────────────
function AddItemPanel({ stores }) {
  const [upc, setUpc] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [cost, setCost] = useState('');
  const [dept, setDept] = useState('');
  const [departments, setDepartments] = useState([]);
  const [deptError, setDeptError] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  // Per-store selection + price, keyed by store id. Names are read live from
  // the `stores` prop at render time (no snapshot) so they always show.
  const [sel, setSel] = useState(() => new Set(stores.map(s => s.id)));
  const [prices, setPrices] = useState({}); // id -> string
  const [bulkPrice, setBulkPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [lookup, setLookup] = useState(null); // { status:'searching'|'found'|'notfound', msg }
  const lookedUp = useRef('');
  const upcRef = useRef(null);

  // Load departments once (they match across stores).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/pricebook/departments');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load departments');
        setDepartments(json.departments || []);
      } catch (e) {
        setDeptError(e.message);
      }
    })();
    upcRef.current?.focus();
  }, []);

  // Look a UPC up across all stores and auto-fill name/size/dept/cost. Only
  // fills fields the user hasn't already typed, so it never clobbers input.
  const lookupUpc = useCallback(async (code) => {
    const u = String(code || '').trim();
    if (!u || u === lookedUp.current) return;
    lookedUp.current = u;
    setLookup({ status: 'searching', msg: 'Looking up product…' });
    try {
      const res = await fetch(`/api/pricebook/lookup?upc=${encodeURIComponent(u)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Lookup failed');
      if (json.found) {
        setName(prev => prev.trim() ? prev : (json.name || ''));
        setSize(prev => prev.trim() ? prev : (json.size || ''));
        setDept(prev => prev || (json.dept || ''));
        setCost(prev => prev.trim() ? prev : (json.costCents ? (json.costCents / 100).toFixed(2) : ''));
        setLookup({
          status: 'found',
          msg: json.source && json.source !== 'store'
            ? 'Name from product database — pick a department.'
            : `Auto-filled from ${json.foundInStore}`,
        });
      } else {
        setLookup({ status: 'notfound', msg: 'New product — type the name below.' });
      }
    } catch (e) {
      setLookup({ status: 'notfound', msg: '' });
    }
  }, []);

  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setPrice = (id, v) => setPrices(p => ({ ...p, [id]: v }));
  const applyBulkPrice = () => {
    if (!bulkPrice.trim()) return;
    const v = (parseFloat(bulkPrice.replace(/[^0-9.]/g, '')) || 0).toFixed(2);
    setPrices(p => { const n = { ...p }; for (const s of stores) if (sel.has(s.id)) n[s.id] = v; return n; });
  };

  const selectedStores = stores.filter(s => sel.has(s.id));
  const canSubmit = upc.trim() && name.trim() && dept && selectedStores.length > 0
    && selectedStores.every(s => (prices[s.id] || '').trim() && Number(prices[s.id]) >= 0);

  const submit = async () => {
    setSubmitting(true); setResult(null);
    try {
      const targets = selectedStores.map(s => ({ store_id: s.id, cents: Math.round(parseFloat(prices[s.id]) * 100) }));
      const res = await fetch('/api/pricebook/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { upc: upc.trim(), name: name.trim(), size: size.trim(), dept, costCents: cost ? Math.round(parseFloat(cost) * 100) : 0 },
          targets,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Create failed');
      setResult(json);
      if (json.failed === 0) {
        // Clear item fields for the next add; keep dept + store selection + prices.
        setUpc(''); setName(''); setSize(''); setCost('');
        upcRef.current?.focus();
      }
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      {/* Item details */}
      <div className="rounded-xl border border-sw-border bg-sw-card p-4">
        <h3 className="text-sw-text text-[15px] font-bold mb-3">Item details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="UPC / barcode">
            <div className="flex gap-2">
              <input ref={upcRef} value={upc}
                onChange={e => { setUpc(e.target.value); if (e.target.value.trim() !== lookedUp.current) setLookup(null); }}
                onBlur={() => lookupUpc(upc)}
                onKeyDown={e => { if (e.key === 'Enter') lookupUpc(upc); }}
                placeholder="Scan or type…"
                className="flex-1 min-w-0 rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text" />
              <Button variant="secondary" onClick={() => setScanOpen(true)} title="Scan with camera">📷 Scan</Button>
            </div>
            {lookup?.msg && (
              <span className={`text-[11px] ${lookup.status === 'found' ? 'text-green-500' : lookup.status === 'searching' ? 'text-[var(--text-muted)]' : 'text-amber-500'}`}>
                {lookup.msg}
              </span>
            )}
          </Field>
          <Field label="Department">
            <select value={dept} onChange={e => setDept(e.target.value)}
              className="w-full rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text">
              <option value="">Select department…</option>
              {departments.map(d => <option key={d.dept} value={d.dept}>{d.label}</option>)}
            </select>
            {deptError && <span className="text-[11px] text-red-500">{deptError}</span>}
          </Field>
          <Field label="Item name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Zig Zag Orange"
              className="w-full rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text" />
          </Field>
          <Field label="Size (optional)">
            <input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 1 ct"
              className="w-full rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text" />
          </Field>
          <Field label="Cost (optional)">
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">$</span>
              <input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="0.00"
                className="w-full rounded-lg border border-sw-border bg-sw-bg px-3 py-2 text-[14px] text-sw-text" />
            </div>
          </Field>
        </div>
      </div>

      {/* Stores + per-store price */}
      <div className="rounded-xl border border-sw-border bg-sw-card p-4 h-fit lg:sticky lg:top-4">
        <h3 className="text-sw-text text-[15px] font-bold mb-1">Add to stores</h3>
        <p className="text-sw-sub text-[12px] mb-3">Tick stores and set each price. Use “set all” when the price is the same.</p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-[var(--text-muted)] text-[13px]">$</span>
          <input value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} inputMode="decimal" placeholder="set all to"
            onKeyDown={e => { if (e.key === 'Enter') applyBulkPrice(); }}
            style={{ width: '6rem' }} className="w-24 rounded-md border border-sw-border bg-sw-bg px-2 py-1 text-[13px] text-sw-text" />
          <Button variant="secondary" onClick={applyBulkPrice} disabled={!bulkPrice.trim()}>Set all</Button>
        </div>

        <ul className="space-y-2 mb-4">
          {stores.map(s => {
            const checked = sel.has(s.id);
            return (
              <li key={s.id} className="flex items-center gap-2">
                <input type="checkbox" className="w-4 h-4 shrink-0 accent-amber-500" checked={checked} onChange={() => toggleSel(s.id)} />
                <span className="flex-1 min-w-0 truncate text-[13px] text-sw-text" title={s.name}>{s.name || s.id}</span>
                <span className="text-[var(--text-muted)] text-[13px]">$</span>
                <input value={prices[s.id] ?? ''} onChange={e => setPrice(s.id, e.target.value)} inputMode="decimal" placeholder="0.00"
                  disabled={!checked}
                  style={{ width: '5rem' }} className={`w-20 rounded-md border bg-sw-bg px-2 py-1 text-[13px] text-sw-text ${checked ? 'border-sw-border' : 'border-sw-border/40 opacity-50'}`} />
              </li>
            );
          })}
        </ul>

        <Button variant="primary" className="w-full" disabled={!canSubmit || submitting} onClick={submit}>
          {submitting ? 'Adding…' : `Add to ${selectedStores.length || ''} store${selectedStores.length === 1 ? '' : 's'}`.trim()}
        </Button>

        {result && (
          <div className="mt-4">
            {result.error ? (
              <Alert type="error">{result.error}</Alert>
            ) : (
              <Alert type={result.failed ? 'warning' : 'success'}>
                Added “{result.name}” to {result.created} store{result.created === 1 ? '' : 's'}
                {result.failed ? `, ${result.failed} failed` : ''}.
                {result.failed > 0 && (
                  <ul className="mt-2 text-[12px] list-disc pl-4">
                    {result.results.filter(r => !r.ok).map(r => (
                      <li key={r.store_id}>{r.store}: {r.error}</li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
          </div>
        )}
      </div>

      {scanOpen && (
        <BarcodeScanModal
          onDetected={(code) => { setUpc(code); setScanOpen(false); lookupUpc(code); }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </div>
  );
}

// ── Camera barcode scanner lives in components/BarcodeScanner.js ─────────
