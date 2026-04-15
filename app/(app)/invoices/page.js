'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, DateBar, useDateRange, Loading, Alert, ImageViewer, ConfirmModal, MultiSelect } from '@/components/UI';
import ImageGallery from '@/components/ImageGallery';
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
  const [vendors, setVendors] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]); // array of vendor names
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState(effectiveStoreId ? [effectiveStoreId] : []); // array of store ids
  const [viewInvoice, setViewInvoice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
    if (effectiveStoreId) setStoreFilter([effectiveStoreId]);
  }, [effectiveStoreId]);

  const reload = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [{ data: st }, { data: vs }] = await Promise.all([
        supabase.from('stores').select('id, name, color').order('name'),
        supabase.from('vendors').select('id, name').order('name'),
      ]);
      setStores(st || []);
      setVendors(vs || []);

      let q = supabase
        .from('invoices')
        .select('*, stores(name, color)')
        .gte('date', range.start).lte('date', range.end)
        .order('date', { ascending: false });
      if (storeFilter.length) q = q.in('store_id', storeFilter);
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

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.start, range.end, storeFilter.join(',')]);

  // Group by vendor for the folder list.
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

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const visible = invoices
    .filter(inv => !vendorFilter.length || vendorFilter.includes(inv.vendor_name || 'Unknown'))
    .filter(inv => {
      if (!search) return true;
      const q = search.toLowerCase();
      const haystack = [
        (inv.vendor_name || '').toLowerCase(),
        (inv.stores?.name || '').toLowerCase(),
        String(inv.amount ?? ''),
        (inv.notes || '').toLowerCase(),
        inv.date || '',
      ].join(' ');
      return haystack.includes(q);
    });

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doBulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) { setConfirmBulk(false); return; }
    try {
      const targets = invoices.filter(i => selected.has(i.id));
      const paths = targets.map(t => t.image_path).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from('invoices').remove(paths);
        if (rmErr) console.warn('[invoices] bulk storage cleanup failed (non-fatal):', rmErr);
      }
      const { error } = await supabase.from('invoices').delete().in('id', ids);
      if (error) throw error;
      setSelected(new Set());
      setConfirmBulk(false);
      reload();
    } catch (e) {
      alert(`Bulk delete failed: ${e.message || e}`);
      setConfirmBulk(false);
    }
  };

  const doDelete = async () => {
    const inv = confirmDelete;
    if (!inv) return;
    try {
      if (inv.image_path) {
        const { error: rmErr } = await supabase.storage.from('invoices').remove([inv.image_path]);
        if (rmErr) console.warn('[invoices] storage cleanup failed (non-fatal):', rmErr);
      }
      const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
      if (error) throw error;
      setConfirmDelete(null);
      reload();
    } catch (e) {
      alert(`Failed to delete invoice: ${e.message || e}`);
      setConfirmDelete(null);
    }
  };

  return (
    <div>
      <PageHeader title="🧾 Invoices" subtitle={`${invoices.length} total · ${vendorGroups.length} vendors`} />

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <MultiSelect
          label="Store"
          placeholder="All Stores"
          value={storeFilter}
          onChange={setStoreFilter}
          options={stores.map(s => ({ value: s.id, label: s.name }))}
        />
        <MultiSelect
          label="Vendor"
          placeholder="All Vendors"
          value={vendorFilter}
          onChange={setVendorFilter}
          options={vendors.map(v => ({ value: v.name, label: v.name }))}
        />
        <input
          type="text"
          placeholder="Search invoices… (vendor, store, amount, notes)"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="!w-full sm:!flex-1 sm:!min-w-[260px] !py-1.5 !text-[11px]"
        />
        {selected.size > 0 && (
          <button
            onClick={() => setConfirmBulk(true)}
            className="text-sw-red text-[11px] font-bold border border-sw-red/40 rounded px-3 py-1.5 bg-sw-redD"
          >
            🗑 Delete Selected ({selected.size})
          </button>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
          No invoices for this period. Upload invoices from the Product Buying page.
        </div>
      ) : (
        <div className="md:flex md:gap-3">
          {/* Vendor folders — sidebar on desktop, horizontal scroll on mobile */}
          <div className="md:w-[220px] md:flex-shrink-0 mb-3 md:mb-0">
            <div className="md:bg-sw-card md:border md:border-sw-border md:rounded-xl md:p-2 md:space-y-1 flex md:flex-col gap-2 md:gap-1 overflow-x-auto md:overflow-visible">
              <button
                onClick={() => setVendorFilter([])}
                className={`flex-shrink-0 md:flex-shrink text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg border min-h-[44px]
                  ${vendorFilter.length === 0 ? 'bg-sw-blueD text-sw-blue border-sw-blue/30' : 'bg-sw-card2 text-sw-text border-sw-border hover:border-sw-blue/30'}`}
              >
                <span className="text-[12px] font-semibold truncate">📁 All Vendors</span>
                <span className="text-[10px] text-sw-sub flex-shrink-0">{invoices.length}</span>
              </button>
              {vendorGroups.map(g => {
                const active = vendorFilter.includes(g.name);
                return (
                  <button
                    key={g.name}
                    onClick={() => setVendorFilter(active ? vendorFilter.filter(v => v !== g.name) : [...vendorFilter, g.name])}
                    className={`flex-shrink-0 md:flex-shrink text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg border min-h-[44px]
                      ${active ? 'bg-sw-blueD text-sw-blue border-sw-blue/30' : 'bg-sw-card2 text-sw-text border-sw-border hover:border-sw-blue/30'}`}
                  >
                    <span className="text-[12px] font-semibold truncate">📁 {g.name}</span>
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
                  <div
                    key={inv.id}
                    className={`relative bg-sw-card border rounded-lg overflow-hidden transition-colors ${selected.has(inv.id) ? 'border-sw-blue ring-2 ring-sw-blue/40' : 'border-sw-border hover:border-sw-blue/40'}`}
                  >
                    <label
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-1.5 left-1.5 z-10 w-7 h-7 rounded-md bg-sw-card2/90 border border-sw-border flex items-center justify-center cursor-pointer"
                      title="Select"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(inv.id)}
                        onChange={() => toggleSelect(inv.id)}
                        className="!w-4 !h-4 !min-h-0 !p-0 !m-0"
                      />
                    </label>
                    <button
                      onClick={() => setViewInvoice({ ...inv, _gallery: visible })}
                      className="block w-full text-left"
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
                        <div className="text-sw-text text-[11px] font-bold truncate">{inv.vendor_name || 'Unknown'}</div>
                        <div className="text-sw-dim text-[10px] truncate">{inv.stores?.name || '—'}</div>
                        <div className="text-sw-sub text-[10px]">{utilDate(inv.date)}</div>
                        <div className="text-sw-amber text-[11px] font-mono font-bold">{fmtMoney(inv.amount)}</div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(inv); }}
                      title="Delete invoice"
                      aria-label="Delete invoice"
                      className="absolute top-1.5 right-1.5 w-8 h-8 rounded-md bg-sw-redD border border-sw-red/40 text-sw-red text-sm flex items-center justify-center"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ImageGallery
        images={viewInvoice?._gallery
          ? viewInvoice._gallery.map(i => ({
              image_url: i.image_url,
              caption: `${i.vendor_name} · ${utilDate(i.date)} · ${i.stores?.name || ''} · ${fmtMoney(i.amount)}`,
              downloadName: `invoice-${i.vendor_name || 'purchase'}-${i.date || ''}.jpg`,
            }))
          : []}
        startIndex={viewInvoice?._gallery ? viewInvoice._gallery.findIndex(i => i.id === viewInvoice.id) : 0}
        isOpen={!!viewInvoice}
        onClose={() => setViewInvoice(null)}
      />

      {confirmBulk && (
        <ConfirmModal
          title="Delete selected invoices?"
          message={`Delete ${selected.size} selected invoice${selected.size === 1 ? '' : 's'}? This cannot be undone.`}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={doBulkDelete}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete this invoice?"
          message={`Delete ${fmtMoney(confirmDelete.amount)} invoice from ${confirmDelete.vendor_name || 'vendor'} dated ${utilDate(confirmDelete.date)}? This removes the image as well.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
