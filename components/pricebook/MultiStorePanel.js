'use client';
import { useState, useCallback, useMemo } from 'react';
import { Button, Alert, Modal } from '@/components/UI';
import { storeShortName } from '@/lib/utils';
import { planWrites, normPrice, countProtected, SKIP_REASON } from '@/lib/pricebook-grouping';
import PriceGrid from '@/components/pricebook/PriceGrid';

const fmtCents = (c) => (Number.isFinite(c) ? `$${(c / 100).toFixed(2)}` : '—');
const toCents = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const cellKey = (storeId, upc) => `${storeId}|${upc}`;

// Change prices for one product across every store at once.
//
// The unit of work is a *family* — a brand and its flavors, grouped by the
// UPC digits they share, because NRS keys everything by UPC and names are
// typed differently in each store. Set one price for the whole family, one
// per flavor, or one per store; whichever is most specific wins.
//
// Stores that deliberately charge a different price are protected: a blanket
// change skips them and says so, unless the owner ticks them in.
export default function MultiStorePanel() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [variantDigits, setVariantDigits] = useState(null);

  // Stores the change applies to. Empty until a search returns.
  const [targetStores, setTargetStores] = useState([]);
  // upc -> target price string, from a family or per-flavor box.
  const [rowTarget, setRowTarget] = useState({});
  // "storeId|upc" -> price string, from typing directly in a cell.
  const [cellEdit, setCellEdit] = useState({});
  const [includeCustom, setIncludeCustom] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const stores = data?.stores || [];
  const families = data?.families || [];
  const allRows = useMemo(() => families.flatMap(f => f.items), [families]);

  // `preserveResult` is set by the post-apply refresh: the owner still needs
  // to read what landed and what failed, so re-reading prices must not wipe
  // the summary off the screen.
  const search = useCallback(async (digits, { preserveResult = false } = {}) => {
    const term = q.trim();
    if (term.length < 2) { setError('Enter at least 2 characters'); return; }
    setLoading(true); setError('');
    if (!preserveResult) setResult(null);
    try {
      const params = new URLSearchParams({ q: term });
      if (digits) params.set('variant_digits', String(digits));
      const res = await fetch(`/api/pricebook/matrix?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setData(json);
      setVariantDigits(json.variantDigits);
      setTargetStores(json.stores.map(s => s.id));
      setRowTarget({}); setCellEdit({}); setIncludeCustom(false);
    } catch (e) {
      setError(e.message); setData(null);
    } finally {
      setLoading(false);
    }
  }, [q]);

  const setFamilyPrice = (family, value) => {
    setRowTarget(prev => {
      const next = { ...prev };
      for (const item of family.items) {
        if (value === '') delete next[item.upc];
        else next[item.upc] = value;
      }
      return next;
    });
  };

  const toggleStore = (id) => setTargetStores(prev =>
    prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  // Everything the owner has asked for, resolved into concrete writes.
  // A cell typed by hand is an explicit instruction, so it is never subject
  // to custom-price protection; family and flavor prices are.
  const plan = useMemo(() => {
    const fromTargets = planWrites(allRows, {
      storeIds: targetStores,
      priceFor: (row) => toCents(rowTarget[row.upc] ?? ''),
      includeCustom,
    });

    const manual = [];
    for (const [key, value] of Object.entries(cellEdit)) {
      const [storeId, upc] = key.split('|');
      const cents = toCents(value);
      const row = allRows.find(r => r.upc === upc);
      if (!row || cents == null || cents < 0) continue;
      if (!Number.isFinite(row.prices[storeId]) || row.prices[storeId] === cents) continue;
      manual.push({ store_id: storeId, upc, name: row.name, from: row.prices[storeId], to: cents });
    }

    // A hand-typed cell overrides whatever the family price said for it.
    const manualKeys = new Set(manual.map(m => cellKey(m.store_id, m.upc)));
    const writes = [
      ...fromTargets.writes.filter(w => !manualKeys.has(cellKey(w.store_id, w.upc))),
      ...manual,
    ];
    const skipped = fromTargets.skipped.filter(
      s => s.reason !== SKIP_REASON.NOT_CARRIED && !manualKeys.has(cellKey(s.store_id, s.upc)),
    );
    return { writes, skipped };
  }, [allRows, targetStores, rowTarget, cellEdit, includeCustom]);

  const protectedCount = useMemo(() => {
    const touched = allRows.filter(r => toCents(rowTarget[r.upc] ?? '') != null);
    return countProtected(touched, targetStores);
  }, [allRows, rowTarget, targetStores]);

  const apply = async () => {
    setReviewOpen(false); setApplying(true); setResult(null);
    try {
      const res = await fetch('/api/pricebook/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: plan.writes.map(w => ({ store_id: w.store_id, upc: w.upc, cents: w.to })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setResult(json);
      setRowTarget({}); setCellEdit({});
      await search(variantDigits, { preserveResult: true });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search(variantDigits)}
          placeholder="Search every store — brand, flavor or UPC (e.g. geekbar)"
          className="!w-full min-w-0 flex-1 rounded-lg border border-sw-border bg-sw-card px-3 py-2 text-[13px] text-sw-text"
        />
        <Button onClick={() => search(variantDigits)} disabled={loading} className="w-full sm:w-auto">
          {loading ? 'Searching…' : 'Search all stores'}
        </Button>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {result && !result.error && (
        <Alert type={result.failed ? 'warning' : 'success'}>
          {result.updated} price{result.updated === 1 ? '' : 's'} updated
          {result.unchanged ? `, ${result.unchanged} already correct` : ''}
          {result.failed ? `, ${result.failed} failed` : ''}.
          {result.failed > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {result.results.filter(r => !r.ok).map(r => (
                <li key={cellKey(r.store_id, r.upc)}>{r.store_name} · {r.upc}: {r.error}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {data?.unavailable?.length > 0 && (
        <Alert type="warning">
          Could not reach {data.unavailable.map(u => u.store).join(', ')} — those columns show “?” rather than a
          price, and nothing will be written to them.
        </Alert>
      )}

      {data && (
        <>
          <StoreSelector stores={stores} selected={targetStores} onToggle={toggleStore} />

          <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px] text-[var(--text-muted)]">
            <span>
              {families.length} product{families.length === 1 ? '' : 's'} · {data.totalItems} item
              {data.totalItems === 1 ? '' : 's'} across {stores.length} stores
            </span>
            <span className="opacity-50">·</span>
            <label className="flex items-center gap-1.5">
              Flavor digits
              <select
                value={variantDigits ?? ''}
                onChange={e => { const d = Number(e.target.value); setVariantDigits(d); search(d); }}
                className="!w-auto !min-w-[64px] rounded border border-sw-border bg-sw-card px-2 py-1 text-[12px] text-sw-text"
              >
                {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <span className="opacity-70">how many digits at the end of the UPC change per flavor</span>
          </div>

          {families.length === 0 && (
            <div className="rounded-xl border border-sw-border p-8 text-center text-[var(--text-muted)]">
              Nothing matched “{data.query}” in any store.
            </div>
          )}

          <div className="space-y-4">
            {families.map(family => (
              <FamilyCard
                key={family.key}
                family={family}
                stores={stores}
                targetStores={targetStores}
                unavailable={data.unavailable || []}
                rowTarget={rowTarget}
                cellEdit={cellEdit}
                onFamilyPrice={v => setFamilyPrice(family, v)}
                onRowPrice={(upc, v) => setRowTarget(p => {
                  const next = { ...p };
                  if (v === '') delete next[upc]; else next[upc] = v;
                  return next;
                })}
                onCellPrice={(storeId, upc, v) => setCellEdit(p => {
                  const next = { ...p };
                  if (v === '') delete next[cellKey(storeId, upc)];
                  else next[cellKey(storeId, upc)] = v;
                  return next;
                })}
              />
            ))}
          </div>
        </>
      )}

      {plan.writes.length > 0 && (
        <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sw-border bg-sw-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="text-[13px] text-sw-text">
            <b>{plan.writes.length}</b> price change{plan.writes.length === 1 ? '' : 's'} ready
            {protectedCount > 0 && !includeCustom && (
              <span className="ml-2 text-[var(--color-warning)]">
                · {protectedCount} store{protectedCount === 1 ? '' : 's'} protected
              </span>
            )}
          </div>
          <Button onClick={() => setReviewOpen(true)} disabled={applying}>
            {applying ? 'Applying…' : 'Review & apply'}
          </Button>
        </div>
      )}

      {reviewOpen && (
        <ReviewModal
          plan={plan}
          stores={stores}
          protectedCount={protectedCount}
          includeCustom={includeCustom}
          onIncludeCustom={setIncludeCustom}
          onCancel={() => setReviewOpen(false)}
          onConfirm={apply}
        />
      )}
    </div>
  );
}

// ── Which stores the change applies to ──────────────────────────────────
function StoreSelector({ stores, selected, onToggle }) {
  const allOn = selected.length === stores.length;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold text-[var(--text-muted)]">Apply to</span>
      {stores.map(s => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${
              on ? 'border-amber-500 bg-amber-500/15 text-sw-text' : 'border-sw-border text-[var(--text-muted)]'
            }`}
          >
            {on ? '✓ ' : ''}{storeShortName(s.name)}
          </button>
        );
      })}
      {!allOn && (
        <span className="text-[11px] text-[var(--text-muted)]">
          {stores.length - selected.length} store{stores.length - selected.length === 1 ? '' : 's'} excluded
        </span>
      )}
    </div>
  );
}

// ── One brand and its flavors, priced across stores ─────────────────────
function FamilyCard({
  family, stores, targetStores, unavailable, rowTarget, cellEdit,
  onFamilyPrice, onRowPrice, onCellPrice,
}) {
  const [open, setOpen] = useState(true);
  const [familyValue, setFamilyValue] = useState('');
  const downStores = new Set(unavailable.map(u => u.store));

  const applyFamily = (v) => { setFamilyValue(v); onFamilyPrice(v); };

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-sw-border px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-[55%] flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left">
          <span className="text-[var(--text-muted)] text-[11px]">{open ? '▾' : '▸'}</span>
          <span className="text-[14px] font-bold text-sw-text">{family.label}</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {family.items.length} flavor{family.items.length === 1 ? '' : 's'}
            {family.upcPrefix ? ` · UPC ${family.upcPrefix}•••` : ''}
          </span>
        </button>
        <label className="ml-auto flex flex-shrink-0 items-center gap-2 text-[12px] text-[var(--text-muted)]">
          Set all flavors
          <input
            value={familyValue}
            onChange={e => applyFamily(e.target.value)}
            placeholder="24.99"
            inputMode="decimal"
            className="!w-24 rounded border border-sw-border bg-sw-bg px-2 py-1.5 text-right text-[14px] text-sw-text"
          />
        </label>
      </div>

      {open && (
        <div className="p-2">
          <PriceGrid
            rows={family.items}
            stores={stores}
            targetStores={targetStores}
            unreachableStores={downStores}
            rowLabel="Set flavor"
            rowValue={row => rowTarget[row.upc] ?? ''}
            rowPlaceholder={row => {
              const norm = normPrice(row.prices);
              return norm != null ? (norm / 100).toFixed(2) : '';
            }}
            onRowChange={onRowPrice}
            cellValue={(storeId, row) => cellEdit[cellKey(storeId, row.upc)]}
            onCellChange={onCellPrice}
          />
        </div>
      )}
    </div>
  );
}

// ── Exactly what will be written, before anything is ────────────────────
function ReviewModal({ plan, stores, protectedCount, includeCustom, onIncludeCustom, onCancel, onConfirm }) {
  const storeName = (id) => stores.find(s => s.id === id)?.name || id;
  const byStore = useMemo(() => {
    const m = new Map();
    for (const w of plan.writes) {
      if (!m.has(w.store_id)) m.set(w.store_id, []);
      m.get(w.store_id).push(w);
    }
    return [...m.entries()];
  }, [plan.writes]);

  const protectedSkips = plan.skipped.filter(s => s.reason === SKIP_REASON.CUSTOM_PRICE);

  return (
    <Modal title="Review price changes" onClose={onCancel} wide>
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        These write straight to the live NRS pricebook and take effect at the register immediately.
      </p>

      {protectedSkips.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="text-[12px] font-semibold text-sw-text">
            {protectedCount} store price{protectedCount === 1 ? ' is' : 's are'} deliberately different — left alone
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--text-muted)]">
            {protectedSkips.slice(0, 8).map(s => (
              <li key={cellKey(s.store_id, s.upc)}>
                {storeName(s.store_id)} · {s.name} — staying at {fmtCents(s.from)} (not {fmtCents(s.to)})
              </li>
            ))}
            {protectedSkips.length > 8 && <li>…and {protectedSkips.length - 8} more</li>}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-sw-text">
            <input type="checkbox" checked={includeCustom} onChange={e => onIncludeCustom(e.target.checked)} />
            Change these too
          </label>
        </div>
      )}

      <div className="max-h-[340px] overflow-y-auto rounded-lg border border-sw-border">
        {byStore.map(([storeId, writes]) => (
          <div key={storeId}>
            <div className="sticky top-0 bg-sw-card px-3 py-1.5 text-[11px] font-bold uppercase text-[var(--text-muted)]">
              {storeName(storeId)} · {writes.length} change{writes.length === 1 ? '' : 's'}
            </div>
            {writes.map(w => (
              <div key={cellKey(w.store_id, w.upc)} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                <span className="min-w-0 truncate text-sw-text">{w.name}</span>
                <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{w.upc}</span>
                <span className="flex-shrink-0 text-sw-text">
                  {fmtCents(w.from)} <span className="text-[var(--text-muted)]">→</span>{' '}
                  <b className="text-amber-400">{fmtCents(w.to)}</b>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm}>
          Apply {plan.writes.length} change{plan.writes.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  );
}
