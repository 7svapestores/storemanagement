'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Loading, StoreBadge, ConfirmModal, StoreRequiredModal, ImageViewer, MultiSelect, SmartDatePicker, SortDropdown } from '@/components/UI';
import ImageGallery from '@/components/ImageGallery';
import { fmt, dateLabel, today, downloadCSV } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';
import { uploadInvoice, compressImage } from '@/lib/storage';

export default function PurchasesPage() {
  const { supabase, isOwner, profile, effectiveStoreId, setSelectedStore } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [invoiceByPurchase, setInvoiceByPurchase] = useState({});
  const [viewInvoice, setViewInvoice] = useState(null);
  const [galleryImages, setGalleryImages] = useState(null); // array | null
  const [editItem, setEditItem] = useState(null);
  const [vendorFilter, setVendorFilter] = useState([]); // array of vendor names
  const [search, setSearch] = useState('');
  const [sortState, setSortState] = useState({ key: 'week_of', dir: 'desc' });
  const purchaseSortOptions = [
    { label: 'Date (newest)', key: 'week_of', dir: 'desc' },
    { label: 'Date (oldest)', key: 'week_of', dir: 'asc' },
    { label: 'Vendor A-Z', key: 'supplier', dir: 'asc' },
    { label: 'Amount (high-low)', key: 'total_cost', dir: 'desc' },
    { label: 'Amount (low-high)', key: 'total_cost', dir: 'asc' },
  ];
  const [pageStoreIds, setPageStoreIds] = useState(effectiveStoreId ? [effectiveStoreId] : []);
  const pageStoreId = pageStoreIds.length === 1 ? pageStoreIds[0] : '';
  const [formStoreId, setFormStoreId] = useState('');
  const [form, setForm] = useState({ week_of: today(), amount: '', vendor_id: '', notes: '' });

  useEffect(() => {
    if (effectiveStoreId) setPageStoreIds([effectiveStoreId]);
  }, [effectiveStoreId]);

  const blankForm = () => ({ week_of: today(), amount: '', vendor_id: vendors[0]?.id || '', notes: '' });
  const [newVendorName, setNewVendorName] = useState('');
  // Multi-image upload: pending = newly selected files for current modal session
  // existingInvoices = invoices already in the DB for the row being edited
  const [pendingInvoices, setPendingInvoices] = useState([]); // [{ id, file, preview }]
  const [existingInvoices, setExistingInvoices] = useState([]); // [{ id, image_url, image_path }]
  const [confirmRemoveExisting, setConfirmRemoveExisting] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState('');
  const [formError, setFormError] = useState('');
  const invoiceCameraRef = useRef(null);
  const invoiceLibraryRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: st }, { data: v0 }] = await Promise.all([
        supabase.from('stores').select('*').order('created_at'),
        supabase.from('vendors').select('*').order('name'),
      ]);
      setStores(st || []);

      // Fallback: if vendors table is empty, seed the 7 defaults so the
      // dropdown is never blank on a fresh install.
      let v = v0;
      if (!v || v.length === 0) {
        const defaults = ['Rave', 'Frontline', 'SmokeHub', 'Smoke and Vape King', 'Nepa', 'American', 'DXD']
          .map(name => ({ name, category: 'Smoke/Vape Wholesale', contact: '', phone: '', email: '', notes: '' }));
        const { error: seedErr } = await supabase.from('vendors').insert(defaults);
        if (seedErr) {
          console.error('[purchases] vendor seed failed:', seedErr);
        } else {
          const { data: reloaded } = await supabase.from('vendors').select('*').order('name');
          v = reloaded || [];
        }
      }
      setVendors(v || []);

      let q = supabase.from('purchases')
        .select('*, stores(name, color)')
        .gte('week_of', range.start).lte('week_of', range.end)
        .order('week_of', { ascending: false });
      if (pageStoreIds.length) q = q.in('store_id', pageStoreIds);
      const { data: p } = await q;
      setItems(p || []);

      // Look up which of these purchases have invoices attached, in one query.
      const purchaseIds = (p || []).map(x => x.id).filter(Boolean);
      if (purchaseIds.length) {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, purchase_id, image_url, image_path, amount, vendor_name, date')
          .in('purchase_id', purchaseIds);
        const map = {};
        (invs || []).forEach(i => {
          if (!i.purchase_id) return;
          if (!map[i.purchase_id]) map[i.purchase_id] = [];
          map[i.purchase_id].push(i);
        });
        setInvoiceByPurchase(map);
      } else {
        setInvoiceByPurchase({});
      }

      if (!form.vendor_id && v?.length) setForm(f => ({ ...f, vendor_id: v[0].id }));
    } catch (err) {
      console.error('[purchases] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, pageStoreIds.join(',')]);
  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const amount = parseFloat(form.amount) || 0;
    const vendor = vendors.find(v => v.id === form.vendor_id);

    if (!formStoreId) { setFormError('Please select a store'); return; }
    setFormError('');
    if (!form.vendor_id) { alert('Select a vendor'); return; }
    if (amount <= 0) { alert('Total amount must be greater than 0'); return; }

    // "Other" → create a new vendor row, then use its id for this purchase.
    let effectiveVendor = vendor;
    let effectiveVendorId = form.vendor_id;
    if (form.vendor_id === '__other__') {
      const name = (newVendorName || '').trim();
      if (!name) { alert('Enter the new vendor name'); return; }
      const { data: newVendor, error: vendErr } = await supabase
        .from('vendors')
        .insert({ name, category: 'Smoke/Vape Wholesale', contact: '', phone: '', email: '', notes: '' })
        .select()
        .single();
      if (vendErr) { alert(`Failed to add vendor: ${vendErr.message}`); return; }
      effectiveVendor = newVendor;
      effectiveVendorId = newVendor.id;
      setVendors(v => [...v, newVendor].sort((a, b) => a.name.localeCompare(b.name)));
      setNewVendorName('');
      setToast(`New vendor added: ${newVendor.name}`);
      setTimeout(() => setToast(''), 3500);
    }

    // Simplified form: item = vendor name, quantity = 1, unit_cost = amount
    // (kept this shape for backward compat with the purchases table schema).
    const payload = {
      store_id: formStoreId,
      week_of: form.week_of,
      item: effectiveVendor?.name || 'Purchase',
      quantity: 1,
      unit_cost: amount,
      vendor_id: effectiveVendorId,
      supplier: effectiveVendor?.name || '',
      notes: (form.notes || '').trim() || null,
    };

    setUploading(true);
    const wasEdit = !!editItem;
    const result = wasEdit
      ? await supabase.from('purchases').update(payload).eq('id', editItem.id).select().single()
      : await supabase.from('purchases').insert(payload).select().single();
    const inserted = result.data;
    const error = result.error;
    if (error) { setUploading(false); alert(error.message); return; }
    const storeName = stores.find(s => s.id === formStoreId)?.name;

    // Multi-image invoice upload — each pending file becomes its own invoices row
    // linked to this purchase. Existing invoices that the user removed in-modal
    // were already deleted via removeExistingInvoice().
    if (pendingInvoices.length) {
      let failures = 0;
      for (const p of pendingInvoices) {
        try {
          const compressed = await compressImage(p.file);
          const { path, url } = await uploadInvoice(supabase, compressed, {
            storeName,
            vendorName: effectiveVendor?.name || 'unknown',
            date: form.week_of,
          });
          const { error: invErr } = await supabase.from('invoices').insert({
            store_id: formStoreId,
            vendor_id: effectiveVendorId === '__other__' ? null : effectiveVendorId,
            vendor_name: effectiveVendor?.name || 'unknown',
            purchase_id: inserted?.id,
            image_url: url,
            image_path: path,
            date: form.week_of,
            amount,
            notes: payload.notes,
            uploaded_by: profile?.id,
          });
          if (invErr) { console.error('[purchases] invoice insert failed:', invErr); failures++; }
        } catch (e) {
          console.error('[purchases] invoice upload failed:', e);
          failures++;
        }
      }
      if (failures) alert(`Purchase saved, but ${failures} of ${pendingInvoices.length} invoice image(s) failed to upload.`);
    }
    setUploading(false);
    await logActivity(supabase, profile, {
      action: wasEdit ? 'update' : 'create',
      entityType: 'purchase',
      entityId: inserted?.id,
      description: `${profile?.name} ${wasEdit ? 'updated' : 'added'} purchase of ${fmtMoney(amount)} from ${effectiveVendor?.name || 'unknown vendor'} for ${storeName} on ${shortDate(form.week_of)}`,
      storeName,
      metadata: wasEdit ? { before: editItem, after: payload } : null,
    });
    setModal(false);
    setEditItem(null);
    setPendingInvoices([]);
    setExistingInvoices([]);
    load();
  };

  const handleInvoicePick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const additions = await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve({ id: `pend_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, file, preview: ev.target.result });
      reader.readAsDataURL(file);
    })));
    setPendingInvoices(prev => [...prev, ...additions]);
    e.target.value = '';
  };

  const removePendingInvoice = (id) => {
    setPendingInvoices(prev => prev.filter(p => p.id !== id));
  };

  const removeExistingInvoice = async (inv) => {
    try {
      if (inv.image_path) {
        const { error: rmErr } = await supabase.storage.from('invoices').remove([inv.image_path]);
        if (rmErr) console.warn('[purchases] storage cleanup failed (non-fatal):', rmErr);
      }
      const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
      if (error) throw error;
      setExistingInvoices(prev => prev.filter(e => e.id !== inv.id));
      setConfirmRemoveExisting(null);
      // refresh the per-row map so the table reflects the change
      setInvoiceByPurchase(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = (next[k] || []).filter(i => i.id !== inv.id);
        }
        return next;
      });
    } catch (e) {
      alert(`Failed to delete invoice image: ${e.message || e}`);
      setConfirmRemoveExisting(null);
    }
  };

  const doDelete = async () => {
    const row = confirmDelete;
    if (!row) return;

    // 1. Find any linked invoices so we can clean up their storage files too.
    const { data: linkedInvoices } = await supabase
      .from('invoices')
      .select('id, image_path')
      .eq('purchase_id', row.id);

    // 2. Delete image files from the storage bucket.
    if (linkedInvoices?.length) {
      const paths = linkedInvoices.map(i => i.image_path).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from('invoices').remove(paths);
        if (rmErr) console.warn('[purchases] storage cleanup failed (non-fatal):', rmErr);
      }
      // 3. Delete the invoice rows.
      const { error: invErr } = await supabase.from('invoices').delete().eq('purchase_id', row.id);
      if (invErr) { alert(`Failed to delete linked invoice: ${invErr.message}`); setConfirmDelete(null); return; }
    }

    // 4. Finally delete the purchase row itself.
    const { error } = await supabase.from('purchases').delete().eq('id', row.id);
    if (error) { alert(error.message); setConfirmDelete(null); return; }

    await logActivity(supabase, profile, {
      action: 'delete',
      entityType: 'purchase',
      entityId: row.id,
      description: `${profile?.name} deleted purchase of ${fmtMoney(row.total_cost)} from ${row.supplier || 'vendor'} for ${row.stores?.name} on ${shortDate(row.week_of)}${linkedInvoices?.length ? ` (${linkedInvoices.length} invoice removed)` : ''}`,
      storeName: row.stores?.name,
      metadata: { deleted: row, invoices_removed: linkedInvoices?.length || 0 },
    });
    setConfirmDelete(null);
    load();
  };

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const hasStore = !!pageStoreId;
  const storeName = stores.find(s => s.id === pageStoreId)?.name;

  const tryOpenAdd = () => {
    setEditItem(null);
    setForm(blankForm());
    setFormStoreId(pageStoreId || '');
    setFormError('');
    setPendingInvoices([]);
    setExistingInvoices([]);
    setModal(true);
  };

  const openEdit = (row) => {
    setEditItem(row);
    setForm({
      week_of: row.week_of,
      amount: String(row.total_cost ?? row.unit_cost ?? ''),
      vendor_id: row.vendor_id || vendors.find(v => v.name === row.supplier)?.id || '',
      notes: row.notes || '',
    });
    setFormStoreId(row.store_id || pageStoreId || '');
    setPendingInvoices([]);
    setExistingInvoices(invoiceByPurchase[row.id] || []);
    setModal(true);
  };

  // Vendor filter + free-text search applied client-side on the loaded rows.
  const visibleItems = items.filter(p => {
    if (vendorFilter.length && !vendorFilter.includes(p.supplier)) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        (p.supplier || '').toLowerCase(),
        (p.stores?.name || '').toLowerCase(),
        String(p.total_cost ?? p.unit_cost ?? ''),
        (p.notes || '').toLowerCase(),
        p.week_of || '',
      ].join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const visibleTotal = visibleItems.reduce((s, r) => s + Number(r.total_cost || 0), 0);

  return (<div>
    {toast && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-sw-greenD text-[var(--color-success)] border border-sw-green/40 rounded-lg px-4 py-2 text-[12px] font-semibold shadow-lg">
        ✓ {toast}
      </div>
    )}
    <PageHeader title="🛒 Product Buying" subtitle={hasStore ? storeName : 'All Stores'}>
      <Button variant="secondary" onClick={() => downloadCSV('purchases.csv', ['Date','Store','Vendor','Amount','Notes'], visibleItems.map(p => [p.week_of, p.stores?.name, p.supplier, p.total_cost, p.notes]))} className="!text-[11px]">📥 CSV</Button>
      <Button onClick={tryOpenAdd} className="hidden md:inline-flex">+ Add</Button>
    </PageHeader>

    {/* Mobile-only floating action button — sits above the bottom nav */}
    <button
      onClick={tryOpenAdd}
      className="md:hidden fixed right-4 z-30 rounded-full bg-sw-blue text-black text-2xl font-extrabold shadow-lg w-14 h-14 flex items-center justify-center"
      style={{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
      aria-label="Add purchase"
    >
      +
    </button>
    <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
      <MultiSelect
        label="Store"
        placeholder="All Stores"
        unitLabel="store"
        value={pageStoreIds}
        onChange={setPageStoreIds}
        options={stores.map(s => ({ value: s.id, label: s.name }))}
      />
    </div>
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

    {/* Vendor filter + search */}
    <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
      <SortDropdown options={purchaseSortOptions} value={sortState} onChange={setSortState} />
      <MultiSelect
        label="Vendor"
        placeholder="All Vendors"
        unitLabel="vendor"
        value={vendorFilter}
        onChange={setVendorFilter}
        options={vendors.map(v => ({ value: v.name, label: v.name }))}
      />
      <input
        type="text"
        placeholder="Search purchases… (vendor, store, amount, notes)"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="!w-full sm:!flex-1 sm:!min-w-[260px] !py-1.5 !text-[11px]"
      />
      {(vendorFilter.length || search) && (
        <button onClick={() => { setVendorFilter([]); setSearch(''); }} className="text-[var(--text-muted)] text-[10px] underline">clear</button>
      )}
    </div>
    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
      <DataTable
        sortState={sortState}
        onSortChange={setSortState}
        emptyMessage="No purchases yet. Tap + Add to log an invoice."
        columns={[
          { key: 'week_of', label: 'Date', render: v => dateLabel(v) },
          ...(!pageStoreId ? [{ key: 'store_id', label: 'Store', hideOnMobile: true, render: (_,r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> }] : []),
          { key: 'supplier', label: 'Vendor', render: v => <span className="text-[var(--text-primary)] font-bold">{v || '—'}</span> },
          { key: 'total_cost', label: 'Amount', align: 'right', mono: true, render: (v, r) => {
            const invs = invoiceByPurchase[r.id] || [];
            return (
              <span className="inline-flex items-center gap-1.5 justify-end">
                {invs.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setGalleryImages(invs.map(i => ({ image_url: i.image_url, caption: `${i.vendor_name || ''} · ${i.date || ''}`, downloadName: `invoice-${i.vendor_name || 'purchase'}-${i.date || ''}.jpg` }))); }}
                    title={invs.length > 1 ? `View invoice (${invs.length})` : 'View invoice'}
                    className="md:hidden inline-flex items-center justify-center w-7 h-7 rounded-md bg-sw-blueD text-[var(--color-info)] border border-sw-blue/30 text-sm relative"
                  >
                    📷{invs.length > 1 && <span className="absolute -top-1 -right-1 bg-sw-blue text-black text-[9px] rounded-full px-1 font-bold">{invs.length}</span>}
                  </button>
                )}
                <span className="text-[var(--color-warning)] text-[14px] font-extrabold">{fmt(v)}</span>
              </span>
            );
          } },
          { key: '_invoice', label: 'Invoice', align: 'center', hideOnMobile: true, render: (_, r) => {
            const invs = invoiceByPurchase[r.id] || [];
            if (!invs.length) return <span className="text-[var(--text-muted)] text-base">—</span>;
            return (
              <button
                onClick={() => setGalleryImages(invs.map(i => ({ image_url: i.image_url, caption: `${i.vendor_name || ''} · ${i.date || ''}`, downloadName: `invoice-${i.vendor_name || 'purchase'}-${i.date || ''}.jpg` })))}
                title={invs.length > 1 ? `View invoice (${invs.length})` : 'View invoice'}
                className="relative inline-flex items-center justify-center w-11 h-11 rounded-lg bg-sw-blueD text-[var(--color-info)] border border-sw-blue/30 text-xl"
              >
                📷
                {invs.length > 1 && <span className="absolute -top-1 -right-1 bg-sw-blue text-black text-[10px] rounded-full px-1.5 font-bold">{invs.length}</span>}
              </button>
            );
          } },
          { key: 'notes', label: 'Notes', hideOnMobile: true, render: v => <span className="text-[var(--text-secondary)] text-[11px]">{v || '—'}</span> },
          ...(isOwner ? [{
            key: '_actions', label: '', align: 'right', render: (_, r) => (
              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                <button
                  onClick={() => openEdit(r)}
                  className="inline-flex items-center justify-center px-3 rounded-md bg-sw-blueD border border-sw-blue/30 text-[var(--color-info)] text-[12px] font-semibold"
                  style={{ minHeight: 32 }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(r)}
                  className="inline-flex items-center justify-center px-3 rounded-md bg-sw-redD border border-sw-red/30 text-[var(--color-danger)] text-[12px] font-semibold"
                  style={{ minHeight: 32 }}
                >
                  Delete
                </button>
              </div>
            ),
          }] : []),
        ]}
        rows={visibleItems}
        isOwner={false}
      />
      {visibleItems.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex justify-between items-center">
          <span className="text-[var(--text-secondary)] text-[11px] font-bold uppercase tracking-wide">
            Total{vendorFilter ? ` (${vendorFilter})` : ''}
          </span>
          <span className="text-[var(--color-warning)] text-[16px] font-extrabold font-mono">{fmt(visibleTotal)}</span>
        </div>
      )}
    </div>
    {modal && <Modal title={editItem ? 'Edit Purchase' : 'Log Purchase'} onClose={() => { setModal(false); setEditItem(null); }}>
      <Field label="Store">
        <select
          value={formStoreId}
          onChange={e => { setFormStoreId(e.target.value); if (e.target.value) setFormError(''); }}
          style={formError ? { borderColor: '#F87171' } : undefined}
        >
          <option value="">Select store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {formError && (
          <div className="text-[var(--color-danger)] text-[11px] font-semibold mt-1">{formError}</div>
        )}
      </Field>

      <Field label="Date"><SmartDatePicker value={form.week_of} onChange={v => setForm({...form, week_of: v})} /></Field>

      <Field label="Vendor">
        <select value={form.vendor_id} onChange={e => setForm({...form, vendor_id: e.target.value})}>
          <option value="">Select vendor…</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          <option value="__other__">+ Other (add new)</option>
        </select>
        {form.vendor_id === '__other__' && (
          <input
            className="mt-2"
            placeholder="New vendor name"
            value={newVendorName}
            onChange={e => setNewVendorName(e.target.value)}
          />
        )}
      </Field>

      <Field label="Total Amount">
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={e => setForm({...form, amount: e.target.value.replace(/^-/, '')})}
          className="!text-[22px] !font-mono !font-extrabold !py-3 !text-[var(--color-success)]"
        />
      </Field>

      <Field label={`Invoice Images (optional) — ${existingInvoices.length + pendingInvoices.length} attached`}>
        <div className="flex gap-2 flex-col sm:flex-row mb-2">
          <button
            type="button"
            onClick={() => invoiceCameraRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-[var(--color-info)] text-[13px] font-semibold min-h-[44px]"
          >
            <span className="text-lg">📷</span><span>Take Photo</span>
          </button>
          <button
            type="button"
            onClick={() => invoiceLibraryRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-[var(--color-info)] text-[13px] font-semibold min-h-[44px]"
          >
            <span className="text-lg">📁</span><span>From Library</span>
          </button>
          <input ref={invoiceCameraRef} type="file" accept="image/*" capture="environment" onChange={handleInvoicePick} className="hidden" />
          <input ref={invoiceLibraryRef} type="file" accept="image/*" multiple onChange={handleInvoicePick} className="hidden" />
        </div>

        {(existingInvoices.length + pendingInvoices.length) > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {existingInvoices.map(inv => (
              <div key={inv.id} className="relative group">
                <button
                  type="button"
                  onClick={() => setViewInvoice(inv)}
                  className="block w-full aspect-square rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-black/20"
                >
                  <img src={inv.image_url} alt="Invoice" className="w-full h-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveExisting(inv)}
                  title="Delete this invoice image"
                  className="absolute top-1 right-1 w-7 h-7 rounded-md bg-sw-redD border border-sw-red/50 text-[var(--color-danger)] text-sm flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            ))}
            {pendingInvoices.map(p => (
              <div key={p.id} className="relative">
                <button
                  type="button"
                  onClick={() => setViewInvoice({ image_url: p.preview, vendor_name: 'Preview', date: form.week_of, amount: parseFloat(form.amount) || 0 })}
                  className="block w-full aspect-square rounded-lg overflow-hidden border border-sw-blue/40 bg-black/20"
                >
                  <img src={p.preview} alt="Pending" className="w-full h-full object-cover" />
                </button>
                <span className="absolute top-1 left-1 bg-sw-blueD text-[var(--color-info)] border border-sw-blue/40 text-[9px] font-bold px-1 rounded">NEW</span>
                <button
                  type="button"
                  onClick={() => removePendingInvoice(p.id)}
                  title="Remove"
                  className="absolute top-1 right-1 w-7 h-7 rounded-md bg-sw-redD border border-sw-red/50 text-[var(--color-danger)] text-sm flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="Notes (optional)">
        <input
          placeholder="e.g. Invoice #52964, Paid cash"
          value={form.notes}
          onChange={e => setForm({...form, notes: e.target.value})}
        />
      </Field>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => { setModal(false); setEditItem(null); setNewVendorName(''); setPendingInvoices([]); setExistingInvoices([]); }}>Cancel</Button>
        <Button onClick={handleSave} disabled={uploading}>{uploading ? 'Saving…' : (editItem ? 'Update' : 'Save')}</Button>
      </div>
    </Modal>}
    <ImageGallery
      images={galleryImages || []}
      isOpen={!!galleryImages}
      onClose={() => setGalleryImages(null)}
    />
    {viewInvoice && (
      <ImageViewer
        src={viewInvoice.image_url}
        caption={`${viewInvoice.vendor_name} · ${viewInvoice.date} · ${fmtMoney(viewInvoice.amount)}`}
        onClose={() => setViewInvoice(null)}
        downloadName={`invoice-${viewInvoice.vendor_name || 'purchase'}-${viewInvoice.date || ''}.jpg`}
      />
    )}
    {showStorePicker && (
      <StoreRequiredModal
        stores={stores}
        onCancel={() => setShowStorePicker(false)}
        onSelectStore={(s) => {
          setSelectedStore(s.id);
          setShowStorePicker(false);
          setForm(blankForm());
          setModal(true);
        }}
      />
    )}
    {confirmRemoveExisting && (
      <ConfirmModal
        title="Delete this invoice image?"
        message={`Remove this invoice image? The file will be deleted from storage and cannot be recovered.`}
        onCancel={() => setConfirmRemoveExisting(null)}
        onConfirm={() => removeExistingInvoice(confirmRemoveExisting)}
      />
    )}
    {confirmDelete && (
      <ConfirmModal
        title="Delete this purchase?"
        message={`Are you sure? This will be logged in the activity trail. Deleting ${fmtMoney(confirmDelete.total_cost)} from ${confirmDelete.supplier || 'vendor'} for ${confirmDelete.stores?.name || 'store'}.`}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    )}
  </div>);
}
