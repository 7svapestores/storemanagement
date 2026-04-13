'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, DateBar, useDateRange, Loading, Alert, ImageViewer } from '@/components/UI';
import { dayLabel } from '@/lib/utils';

const utilDate = (d) => {
  try { return dayLabel(d); } catch { return String(d); }
};

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoicesPage() {
  const { supabase, isOwner, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stores, setStores] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [viewInvoice, setViewInvoice] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: st } = await supabase.from('stores').select('id, name, color').order('name');
        setStores(st || []);

        let q = supabase
          .from('invoices')
          .select('*, stores(name, color)')
          .gte('date', range.start).lte('date', range.end)
          .order('date', { ascending: false });
        if (effectiveStoreId) q = q.eq('store_id', effectiveStoreId);
        const { data, error } = await q;
        if (error) throw error;
        setInvoices(data || []);
      } catch (e) {
        console.error('[invoices] load failed:', e);
        setLoadError(e?.message || 'Failed to load invoices');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range.start, range.end, effectiveStoreId]);

  // Group by vendor.
  const vendorGroups = useMemo(() => {
    const map = {};
    for (const inv of invoices) {
      const key = inv.vendor_name || 'Unknown';
      if (!map[key]) map[key] = [];
      map[key].push(inv);
    }
    return Object.entries(map)
      .map(([name, list]) => ({ name, list }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [invoices]);

  // When vendor isn't set yet, default to the first one.
  useEffect(() => {
    if (!selectedVendor && vendorGroups.length) setSelectedVendor(vendorGroups[0].name);
  }, [vendorGroups, selectedVendor]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const visible = (vendorGroups.find(v => v.name === selectedVendor)?.list || [])
    .filter(inv => !storeFilter || inv.store_id === storeFilter)
    .filter(inv => !search || (inv.notes || '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="🧾 Invoices" subtitle={`${invoices.length} total · ${vendorGroups.length} vendors`} />

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <input
          placeholder="Search notes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="!w-[200px] !py-1.5 !text-[11px]"
        />
        <select
          value={storeFilter}
          onChange={e => setStoreFilter(e.target.value)}
          className="!w-[180px] !py-1.5 !text-[11px]"
        >
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
          No invoices for this period. Upload one from the Product Buying page.
        </div>
      ) : (
        <div className="md:flex md:gap-3">
          {/* Vendor list — sidebar on desktop, horizontal scroll on mobile */}
          <div className="md:w-[220px] md:flex-shrink-0 mb-3 md:mb-0">
            <div className="md:bg-sw-card md:border md:border-sw-border md:rounded-xl md:p-2 md:space-y-1 flex md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-visible">
              {vendorGroups.map(g => {
                const active = g.name === selectedVendor;
                return (
                  <button
                    key={g.name}
                    onClick={() => setSelectedVendor(g.name)}
                    className={`flex-shrink-0 md:flex-shrink text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg border min-h-[44px]
                      ${active ? 'bg-sw-blueD text-sw-blue border-sw-blue/30' : 'bg-sw-card2 text-sw-text border-sw-border hover:border-sw-blue/30'}`}
                  >
                    <span className="text-[12px] font-semibold truncate">{g.name}</span>
                    <span className="text-[10px] text-sw-sub flex-shrink-0">{g.list.length}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Image grid */}
          <div className="flex-1 min-w-0">
            {visible.length === 0 ? (
              <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
                No invoices match your filters.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {visible.map(inv => (
                  <button
                    key={inv.id}
                    onClick={() => setViewInvoice(inv)}
                    className="bg-sw-card border border-sw-border rounded-lg overflow-hidden hover:border-sw-blue/40 transition-colors text-left"
                  >
                    <div className="aspect-square bg-black/30 overflow-hidden">
                      <img
                        src={inv.image_url}
                        alt={inv.vendor_name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="text-sw-text text-[11px] font-semibold truncate">{utilDate(inv.date)}</div>
                      <div className="text-sw-amber text-[11px] font-mono font-bold">{fmtMoney(inv.amount)}</div>
                      <div className="text-sw-dim text-[10px] truncate">{inv.stores?.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewInvoice && (
        <ImageViewer
          src={viewInvoice.image_url}
          caption={`${viewInvoice.vendor_name} · ${utilDate(viewInvoice.date)} · ${viewInvoice.stores?.name || ''} · ${fmtMoney(viewInvoice.amount)}`}
          onClose={() => setViewInvoice(null)}
          downloadName={`invoice-${viewInvoice.vendor_name || 'purchase'}-${viewInvoice.date || ''}.jpg`}
        />
      )}
    </div>
  );
}
