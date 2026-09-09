'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Alert, Loading } from '@/components/UI';
import { downloadCSV } from '@/lib/utils';
import { customStores, normPrice, planWrites, SKIP_REASON } from '@/lib/pricebook-grouping';

const fmtCents = (c) => (Number.isFinite(c) ? `$${(c / 100).toFixed(2)}` : '—');
const toCents = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const cellKey = (storeId, upc) => `${storeId}|${upc}`;

const ago = (iso) => {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return hr < 48 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
};

// The whole pricebook, divided by UPC.
//
// Grouping here is purely numeric: products are bucketed by the leading
// digits of their UPC, with no name matching anywhere in the path. Names are
// shown only as labels. Reading the live NRS pricebook is paged per store, so
// the catalog is synced into a cache first and browsed from there.
export default function CatalogPanel() {
  const [prefixLen, setPrefixLen] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);

  const load = useCallback(async (len) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/pricebook/catalog?prefix_len=${len}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load catalog');
      setData(json);
    } catch (e) {
      setError(e.message); setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(prefixLen); }, [load, prefixLen]);

  // Page through every store, one request at a time. The loop lives here
  // rather than in the API so no single request has to finish the whole
  // catalog inside the platform's function timeout.
  const runSync = async () => {
    if (!data?.stores?.length) return;
    setSyncing(true); setError('');
    const runId = `${Date.now()}`;
    try {
      for (const store of data.stores) {
        let start = 0;
        for (;;) {
          setProgress({ store: store.name, done: start });
          const res = await fetch('/api/pricebook/catalog/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ store_id: store.id, start, run_id: runId }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(`${store.name}: ${json.error || 'Sync failed'}`);
          setProgress({ store: store.name, done: start + json.fetched, total: json.total });
          if (json.done || json.next_start == null) break;
          start = json.next_start;
        }
      }
      await load(prefixLen);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false); setProgress(null);
    }
  };

  const groups = useMemo(() => {
    const all = data?.groups || [];
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter(g =>
      g.prefix.startsWith(f) || (g.sample_name || '').toLowerCase().includes(f));
  }, [data, filter]);

  const exportCsv = () => {
    downloadCSV(
      `upc-catalog-${prefixLen}-digit-groups.csv`,
      ['UPC prefix', 'Distinct UPCs', 'Stores carrying', 'Example name', 'Lowest price', 'Highest price'],
      groups.map(g => [
        g.prefix, g.upc_count, g.store_count, g.sample_name || '',
        fmtCents(g.min_cents), fmtCents(g.max_cents),
      ]),
    );
  };

  const totalItems = (data?.syncStatus || []).reduce((s, r) => s + r.items, 0);
  const neverSynced = (data?.syncStatus || []).every(s => !s.last_synced);

  if (loading && !data) return <Loading />;

  return (
    <div>
      {error && <Alert type="error">{error}</Alert>}

      <div className="mb-4 rounded-xl border border-sw-border bg-sw-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12px] text-[var(--text-muted)]">
            {totalItems.toLocaleString()} items cached across {data?.stores?.length ?? 0} stores
          </div>
          <Button onClick={runSync} disabled={syncing}>
            {syncing ? 'Pulling…' : neverSynced ? 'Pull catalog from POS' : 'Refresh from POS'}
          </Button>
        </div>

        {syncing && progress && (
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
            {progress.store}: {progress.done.toLocaleString()}
            {progress.total ? ` / ${progress.total.toLocaleString()}` : ''} items…
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {(data?.syncStatus || []).map(s => (
            <span key={s.store_id}>
              {s.name}: <b className="text-[var(--text-secondary)]">{s.items.toLocaleString()}</b> · {ago(s.last_synced)}
            </span>
          ))}
        </div>
      </div>

      {neverSynced && !syncing && (
        <Alert type="info">
          Nothing cached yet. “Pull catalog from POS” reads every item from all stores — it takes a few
          minutes the first time, then browsing is instant.
        </Alert>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          Group by first
          <select
            value={prefixLen}
            onChange={e => setPrefixLen(Number(e.target.value))}
            className="rounded border border-sw-border bg-sw-card px-1.5 py-0.5 text-[12px] text-sw-text"
          >
            {[4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          digits of the UPC
        </label>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by UPC prefix or name"
          className="min-w-[200px] flex-1 rounded-lg border border-sw-border bg-sw-card px-3 py-1.5 text-[13px] text-sw-text"
        />
        <Button variant="secondary" onClick={exportCsv} disabled={!groups.length} className="!text-[11px]">
          Export CSV
        </Button>
      </div>

      <div className="mb-2 text-[12px] text-[var(--text-muted)]">
        {groups.length.toLocaleString()} UPC group{groups.length === 1 ? '' : 's'}
      </div>

      <div className="space-y-2">
        {groups.slice(0, 300).map(g => (
          <PrefixGroup key={g.prefix} group={g} stores={data.stores} onChanged={() => load(prefixLen)} />
        ))}
      </div>

      {groups.length > 300 && (
        <div className="mt-3 text-center text-[12px] text-[var(--text-muted)]">
          Showing the 300 largest groups — filter above to narrow down, or export the CSV for the full list.
        </div>
      )}
    </div>
  );
}

// ── One UPC prefix, expanded on demand ──────────────────────────────────
function PrefixGroup({ group, stores, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [targetStores, setTargetStores] = useState(stores.map(s => s.id));
  const [rowTarget, setRowTarget] = useState({});
  const [groupPrice, setGroupPrice] = useState('');
  const [includeCustom, setIncludeCustom] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const expand = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (detail) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/pricebook/catalog/items?prefix=${encodeURIComponent(group.prefix)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load items');
      setDetail(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const rows = detail?.rows || [];

  const plan = useMemo(() => planWrites(rows, {
    storeIds: targetStores,
    priceFor: (row) => toCents(rowTarget[row.upc] ?? ''),
    includeCustom,
  }), [rows, targetStores, rowTarget, includeCustom]);

  const protectedSkips = plan.skipped.filter(s => s.reason === SKIP_REASON.CUSTOM_PRICE);

  const setAll = (v) => {
    setGroupPrice(v);
    setRowTarget(() => {
      if (v === '') return {};
      return Object.fromEntries(rows.map(r => [r.upc, v]));
    });
  };

  const apply = async () => {
    setApplying(true); setResult(null);
    try {
      const res = await fetch('/api/pricebook/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: plan.writes.map(w => ({ store_id: w.store_id, upc: w.upc, cents: w.to })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setResult(json);
      setRowTarget({}); setGroupPrice('');
      // Re-read this group so the table shows what NRS actually holds now.
      const fresh = await fetch(`/api/pricebook/catalog/items?prefix=${encodeURIComponent(group.prefix)}`);
      if (fresh.ok) setDetail(await fresh.json());
      onChanged?.();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card overflow-hidden">
      <button onClick={expand} className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left">
        <span className="text-[11px] text-[var(--text-muted)]">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-[14px] font-bold text-sw-text">{group.prefix}•••</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {group.upc_count} UPC{group.upc_count === 1 ? '' : 's'} · {group.store_count} store
          {group.store_count === 1 ? '' : 's'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
          {group.sample_name}
        </span>
        <span className="text-[12px] text-[var(--text-muted)]">
          {group.min_cents === group.max_cents
            ? fmtCents(group.min_cents)
            : `${fmtCents(group.min_cents)} – ${fmtCents(group.max_cents)}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-sw-border p-3">
          {loading && <Loading />}
          {error && <Alert type="error">{error}</Alert>}
          {result?.error && <Alert type="error">{result.error}</Alert>}
          {result && !result.error && (
            <Alert type={result.failed ? 'warning' : 'success'}>
              {result.updated} updated{result.unchanged ? `, ${result.unchanged} already correct` : ''}
              {result.failed ? `, ${result.failed} failed` : ''}.
            </Alert>
          )}

          {detail && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-[var(--text-muted)]">Apply to</span>
                {stores.map(s => {
                  const on = targetStores.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setTargetStores(p => on ? p.filter(x => x !== s.id) : [...p, s.id])}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        on ? 'border-amber-500 bg-amber-500/15 text-sw-text' : 'border-sw-border text-[var(--text-muted)]'
                      }`}
                    >
                      {on ? '✓ ' : ''}{s.name}
                    </button>
                  );
                })}
                <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                  Set all {rows.length}
                  <input
                    value={groupPrice}
                    onChange={e => setAll(e.target.value)}
                    placeholder="24.99"
                    inputMode="decimal"
                    className="w-20 rounded border border-sw-border bg-sw-bg px-2 py-1 text-[12px] text-sw-text"
                  />
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12px]">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="px-2 py-1.5 text-left font-semibold">UPC</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Name</th>
                      <th className="px-2 py-1.5 text-left font-semibold">New price</th>
                      {stores.map(s => (
                        <th key={s.id} className={`px-2 py-1.5 text-right font-semibold ${targetStores.includes(s.id) ? '' : 'opacity-40'}`}>
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const custom = new Set(customStores(row));
                      const norm = normPrice(row.prices);
                      return (
                        <tr key={row.upc} className="border-t border-sw-border/60">
                          <td className="px-2 py-1.5 font-mono text-[11px] text-sw-text">{row.upc}</td>
                          <td className="px-2 py-1.5">
                            <span className="text-[var(--text-secondary)]">{row.name}</span>
                            {row.nameConflict && (
                              <span className="ml-1.5 text-[10px] text-[var(--color-warning)]" title="Stores spell this item differently">
                                names differ
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={rowTarget[row.upc] ?? ''}
                              onChange={e => setRowTarget(p => {
                                const next = { ...p };
                                if (e.target.value === '') delete next[row.upc];
                                else next[row.upc] = e.target.value;
                                return next;
                              })}
                              placeholder={norm != null ? (norm / 100).toFixed(2) : ''}
                              inputMode="decimal"
                              className="w-20 rounded border border-sw-border bg-sw-bg px-2 py-1 text-[12px] text-sw-text"
                            />
                          </td>
                          {stores.map(s => {
                            const cents = row.prices[s.id];
                            const isCustom = custom.has(s.id);
                            return (
                              <td
                                key={s.id}
                                className={`px-2 py-1.5 text-right ${targetStores.includes(s.id) ? '' : 'opacity-40'} ${
                                  isCustom ? 'text-[var(--color-warning)]' : 'text-sw-text'
                                }`}
                                title={isCustom ? `${s.name} has its own price — protected from “set all”` : undefined}
                              >
                                {fmtCents(cents)}{isCustom ? ' ⚑' : ''}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {protectedSkips.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-warning)]">
                  <input type="checkbox" checked={includeCustom} onChange={e => setIncludeCustom(e.target.checked)} />
                  {protectedSkips.length} store price{protectedSkips.length === 1 ? '' : 's'} deliberately
                  different — change {protectedSkips.length === 1 ? 'it' : 'them'} too
                </label>
              )}

              {plan.writes.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[12px] text-sw-text">
                    <b>{plan.writes.length}</b> price change{plan.writes.length === 1 ? '' : 's'} ready
                  </span>
                  <Button onClick={apply} disabled={applying}>
                    {applying ? 'Applying…' : `Apply ${plan.writes.length} change${plan.writes.length === 1 ? '' : 's'}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
