'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Alert, Loading, EmptyState } from '@/components/UI';

const fmtMoney = (n) => n == null ? '—' : '$' + Number(n || 0).toFixed(2);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const STATUS_BADGES = {
  pending:   { label: 'Pending',   cls: 'bg-sw-card2 text-sw-sub border border-sw-border' },
  approved:  { label: 'Approved',  cls: 'bg-sw-blueD text-sw-blue border border-sw-blue/30' },
  ordered:   { label: 'Ordered',   cls: 'bg-sw-greenD text-sw-green border border-sw-green/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-sw-redD text-sw-red border border-sw-red/30' },
};

export default function RestockPage() {
  const { profile, isOwner, isEmployee } = useAuth();

  if (!profile) return <Loading />;
  return isOwner
    ? <OwnerListView />
    : <EmployeeCartView />;
}

// ═══════════════════════════════════════════════════════════════
// Owner view — list every request across stores with filters,
// click through to the detail page for review.
// ═══════════════════════════════════════════════════════════════
function OwnerListView() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [requests, setRequests] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { supabase } = useAuth();

  useEffect(() => {
    supabase.from('stores').select('id, name, color').order('name').then(({ data }) => setStores(data || []));
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams();
      if (storeFilter) qs.set('store_id', storeFilter);
      if (statusFilter) qs.set('status', statusFilter);
      const r = await fetch(`/api/restock${qs.toString() ? `?${qs}` : ''}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load');
      setRequests(j.requests || []);
    } catch (e) {
      setErr(e.message);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [storeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="py-4 md:py-6 max-w-[1200px]">
      <PageHeader
        title="Restock Requests"
        subtitle="Review what your stores need to reorder. Approve, edit, export, or email POs straight to vendors."
      />

      <div className="bg-sw-card border border-sw-border rounded-xl p-3 mb-4 flex gap-2 flex-wrap items-center">
        <select
          value={storeFilter}
          onChange={e => setStoreFilter(e.target.value)}
          className="!w-auto !min-h-0 !py-1.5 !text-[12px] bg-sw-card2 border border-sw-border rounded-md text-sw-text px-2"
        >
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="!w-auto !min-h-0 !py-1.5 !text-[12px] bg-sw-card2 border border-sw-border rounded-md text-sw-text px-2"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="ordered">Ordered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {err && <Alert type="error">{err}</Alert>}
      {loading && <Loading />}

      {!loading && !err && !requests.length && (
        <EmptyState
          icon="🧺"
          title="No restock requests yet"
          message="Employees can submit a request from their Restock page. When they do, it'll show up here for your review."
        />
      )}

      {!loading && requests.length > 0 && (
        <div className="bg-sw-card border border-sw-border rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-sw-dim text-left border-b border-sw-border">
                <th className="py-2.5 px-3 font-semibold">Store</th>
                <th className="py-2.5 px-3 font-semibold">Submitted by</th>
                <th className="py-2.5 px-3 font-semibold">Items</th>
                <th className="py-2.5 px-3 font-semibold">Date</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="border-b border-sw-border/60 hover:bg-sw-card2/50 transition-colors">
                  <td className="py-2.5 px-3 text-sw-text font-semibold">{r.store?.name || '—'}</td>
                  <td className="py-2.5 px-3 text-sw-sub">{r.created_by_name || '—'}</td>
                  <td className="py-2.5 px-3 text-sw-sub">{r.item_count}</td>
                  <td className="py-2.5 px-3 text-sw-sub">{fmtDate(r.created_at)}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => router.push(`/restock/${r.id}`)}
                      className="text-sw-blue text-[12px] font-semibold hover:underline"
                    >
                      Review →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_BADGES[status] || STATUS_BADGES.pending;
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>;
}

// ═══════════════════════════════════════════════════════════════
// Employee view — build a cart, submit it.
// ═══════════════════════════════════════════════════════════════
function EmployeeCartView() {
  const router = useRouter();
  const { profile } = useAuth();

  const [cart, setCart] = useState([]); // { key, product_name, upc, variant, qty, suggested_vendor?, suggested_unit_price? }
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const r = await fetch('/api/restock');
      const j = await r.json();
      setRecent(j.requests || []);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const addToCart = useCallback((product) => {
    setCart(prev => {
      const key = product.id || `${product.name}:${product.variant || ''}`;
      const existing = prev.find(p => p.key === key);
      if (existing) {
        return prev.map(p => p.key === key ? { ...p, qty: p.qty + 1 } : p);
      }
      return [...prev, {
        key,
        product_name: product.name,
        upc: product.upc || null,
        variant: product.variant || null,
        qty: 1,
        suggested_vendor: product.cheapest?.vendor_name || null,
        suggested_unit_price: product.cheapest?.unit_price || null,
      }];
    });
  }, []);

  const setQty = (key, qty) => {
    setCart(prev => prev.map(p => p.key === key ? { ...p, qty: Math.max(1, qty) } : p));
  };
  const removeItem = (key) => setCart(prev => prev.filter(p => p.key !== key));

  const grandTotal = useMemo(
    () => cart.reduce((s, i) => s + (Number(i.suggested_unit_price) || 0) * i.qty, 0),
    [cart]
  );

  const submit = async () => {
    if (!cart.length) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const r = await fetch('/api/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(c => ({
            product_name: c.product_name,
            upc: c.upc,
            variant: c.variant,
            qty: c.qty,
          })),
          note: note || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Submit failed');
      setCart([]);
      setNote('');
      loadRecent();
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-4 md:py-6 max-w-[1100px]">
      <PageHeader
        title="Restock"
        subtitle="Search your catalog, add what your store needs, and submit the request. The owner will review and place the order."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <SearchPanel onAdd={addToCart} />
        <CartPanel
          cart={cart}
          note={note}
          onNote={setNote}
          onQty={setQty}
          onRemove={removeItem}
          onSubmit={submit}
          submitting={submitting}
          grandTotal={grandTotal}
          error={submitError}
        />
      </div>

      <div className="mt-6 rounded-xl border border-sw-border bg-sw-card p-4">
        <h3 className="text-sw-text text-[15px] font-bold mb-3">Your recent requests</h3>
        {recentLoading ? (
          <div className="text-sw-sub text-[12px]">Loading…</div>
        ) : !recent.length ? (
          <div className="text-sw-dim text-[12px]">No submissions yet.</div>
        ) : (
          <div className="space-y-1.5">
            {recent.map(r => (
              <button
                key={r.id}
                onClick={() => router.push(`/restock/${r.id}`)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-sw-border bg-sw-card2/40 hover:border-sw-blue/40 transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="text-sw-text text-[12.5px] font-semibold truncate">
                    {r.item_count} {r.item_count === 1 ? 'item' : 'items'} · {fmtDate(r.created_at)}
                  </div>
                  {r.note && <div className="text-sw-sub text-[11px] truncate">{r.note}</div>}
                </div>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tiny footer hint when the employee has no store. Profile guarantees one,
          but defensive against edge profiles. */}
      {profile && !profile.store_id && (
        <Alert type="warning">
          Your account has no store assigned. Ask the owner to set one before submitting a request.
        </Alert>
      )}
    </div>
  );
}

// ── Product search (mirrors warehouse-prices "Find best price") ──
function SearchPanel({ onAdd }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [empty, setEmpty] = useState(false); // "no catalog yet"
  const debounceRef = useRef(null);

  // Quickly probe whether the catalog has any products at all, so a brand-new
  // account sees the right empty-state instead of "no matches".
  useEffect(() => {
    fetch('/api/warehouse-prices/prices?limit=1').then(r => r.json()).then(j => {
      setEmpty(!(j.prices && j.prices.length));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setBusy(true); setErr('');
      try {
        const r = await fetch(`/api/warehouse-prices/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Search failed');
        setResults(j.products || []);
      } catch (e) {
        setErr(e.message);
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  if (empty) {
    return (
      <div className="rounded-xl border border-sw-border bg-sw-card p-4">
        <h3 className="text-sw-text text-[15px] font-bold mb-1">Find products</h3>
        <EmptyState
          icon="📦"
          title="No catalog yet"
          message="Ask the owner to upload some vendor invoices on the Warehouse Prices page. Once there are products on file, you'll be able to search and add them here."
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4">
      <h3 className="text-sw-text text-[15px] font-bold mb-1">Find products</h3>
      <p className="text-sw-sub text-[12px] mb-3">
        Search by product name, brand, variant, or UPC. Click to add to your request.
      </p>

      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="e.g. foger berry, geek bar, 850049202930"
        className="w-full px-3 py-2.5 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[13px] focus:outline-none focus:border-sw-blue"
      />

      {busy && <div className="mt-3 text-sw-sub text-[12px]">Searching…</div>}
      {err && <Alert type="error">{err}</Alert>}

      {!busy && !err && q && !results.length && (
        <div className="mt-4">
          <EmptyState icon="🔎" title="No matches" message="Try a shorter query or different spelling." />
        </div>
      )}

      <div className="mt-3 space-y-2 max-h-[480px] overflow-y-auto">
        {results.map(p => {
          const cheapest = p.cheapest;
          return (
            <button
              key={p.id}
              onClick={() => onAdd(p)}
              className="w-full text-left rounded-lg border border-sw-border bg-sw-card2 p-3 hover:border-sw-blue/40 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sw-text text-[13px] font-semibold truncate">{p.name}</div>
                  {p.variant && <div className="text-sw-sub text-[11px] truncate">{p.variant}</div>}
                </div>
                {p.upc && <div className="text-sw-dim text-[10px] font-mono shrink-0">{p.upc}</div>}
              </div>
              {cheapest ? (
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-sw-sub">
                    Cheapest: <span className="text-sw-text font-semibold">{cheapest.vendor_name}</span>
                  </span>
                  <span className="text-sw-blue font-bold">{fmtMoney(cheapest.unit_price)}</span>
                </div>
              ) : (
                <div className="mt-1 text-sw-dim text-[11px]">No price history yet — will submit without a suggestion.</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Cart panel ──
function CartPanel({ cart, note, onNote, onQty, onRemove, onSubmit, submitting, grandTotal, error }) {
  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sw-text text-[15px] font-bold">Your cart</h3>
        <span className="text-sw-sub text-[11px]">{cart.length} {cart.length === 1 ? 'item' : 'items'}</span>
      </div>

      {!cart.length ? (
        <EmptyState icon="🛒" title="Cart is empty" message="Search for products on the left to add them." />
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {cart.map(item => {
            const lineTotal = (Number(item.suggested_unit_price) || 0) * item.qty;
            return (
              <div key={item.key} className="rounded-lg border border-sw-border bg-sw-card2 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sw-text text-[12.5px] font-semibold truncate">{item.product_name}</div>
                    {item.variant && <div className="text-sw-sub text-[11px] truncate">{item.variant}</div>}
                    {item.upc && <div className="text-sw-dim text-[10px] font-mono">{item.upc}</div>}
                  </div>
                  <button
                    onClick={() => onRemove(item.key)}
                    title="Remove"
                    className="text-sw-red text-[11px] px-2 py-0.5 border border-sw-red/30 rounded-md hover:bg-sw-redD shrink-0"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onQty(item.key, item.qty - 1)}
                      className="w-8 h-8 rounded-md bg-sw-card border border-sw-border text-sw-text hover:border-sw-blue/40"
                    >−</button>
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={e => onQty(item.key, parseInt(e.target.value, 10) || 1)}
                      className="w-14 text-center px-2 py-1 bg-sw-card border border-sw-border rounded-md text-sw-text text-[12px]"
                    />
                    <button
                      onClick={() => onQty(item.key, item.qty + 1)}
                      className="w-8 h-8 rounded-md bg-sw-card border border-sw-border text-sw-text hover:border-sw-blue/40"
                    >+</button>
                  </div>
                  <div className="text-right">
                    <div className="text-sw-sub text-[10.5px]">
                      {item.suggested_vendor || 'No vendor yet'} · {fmtMoney(item.suggested_unit_price)}
                    </div>
                    <div className="text-sw-text text-[12px] font-semibold">{fmtMoney(lineTotal)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3">
        <label className="block text-sw-sub text-[10px] font-bold uppercase tracking-wider mb-1">Note (optional)</label>
        <textarea
          value={note}
          onChange={e => onNote(e.target.value)}
          placeholder="Anything the owner should know about this request"
          rows={2}
          className="w-full px-3 py-2 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[12px] focus:outline-none focus:border-sw-blue resize-none"
        />
      </div>

      {cart.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-[12px]">
          <span className="text-sw-sub">Estimated total</span>
          <span className="text-sw-text font-bold">{fmtMoney(grandTotal)}</span>
        </div>
      )}

      {error && <Alert type="error">{error}</Alert>}

      <div className="mt-3">
        <Button
          onClick={onSubmit}
          disabled={!cart.length || submitting}
          className={(!cart.length || submitting) ? 'opacity-50 cursor-not-allowed w-full' : 'w-full'}
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </div>
  );
}
