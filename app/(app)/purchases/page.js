'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Loading, StoreBadge, ConfirmModal, StoreRequiredModal, ImageViewer } from '@/components/UI';
import { fmt, weekLabel, today, downloadCSV } from '@/lib/utils';
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
  const [form, setForm] = useState({ week_of: today(), amount: '', vendor_id: '', notes: '' });

  const blankForm = () => ({ week_of: today(), amount: '', vendor_id: vendors[0]?.id || '', notes: '' });
  const [newVendorName, setNewVendorName] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [uploading, setUploading] = useState(false);

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
      if (effectiveStoreId) q = q.eq('store_id', effectiveStoreId);
      const { data: p } = await q;
      setItems(p || []);

      // Look up which of these purchases have invoices attached, in one query.
      const purchaseIds = (p || []).map(x => x.id).filter(Boolean);
      if (purchaseIds.length) {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, purchase_id, image_url, amount, vendor_name, date')
          .in('purchase_id', purchaseIds);
        const map = {};
        (invs || []).forEach(i => { if (i.purchase_id) map[i.purchase_id] = i; });
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
  }, [range.start, range.end, effectiveStoreId]);
  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const amount = parseFloat(form.amount) || 0;
    const vendor = vendors.find(v => v.id === form.vendor_id);

    if (!effectiveStoreId) { alert('Select a store from the sidebar first.'); return; }
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
    }

    // Simplified form: item = vendor name, quantity = 1, unit_cost = amount
    // (kept this shape for backward compat with the purchases table schema).
    const payload = {
      store_id: effectiveStoreId,
      week_of: form.week_of,
      item: effectiveVendor?.name || 'Purchase',
      quantity: 1,
      unit_cost: amount,
      vendor_id: effectiveVendorId,
      supplier: effectiveVendor?.name || '',
      notes: (form.notes || '').trim() || null,
    };

    setUploading(true);
    const { data: inserted, error } = await supabase.from('purchases').insert(payload).select().single();
    if (error) { setUploading(false); alert(error.message); return; }
    const storeName = stores.find(s => s.id === effectiveStoreId)?.name;

    // Optional invoice image upload — links to the purchase row we just inserted.
    if (invoiceFile) {
      try {
        const compressed = await compressImage(invoiceFile);
        const { path, url } = await uploadInvoice(supabase, compressed, {
          storeName,
          vendorName: effectiveVendor?.name || 'unknown',
          date: form.week_of,
        });
        const { error: invErr } = await supabase.from('invoices').insert({
          store_id: effectiveStoreId,
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
        if (invErr) console.error('[purchases] invoice insert failed:', invErr);
      } catch (e) {
        console.error('[purchases] invoice upload failed:', e);
        alert(`Purchase saved, but invoice upload failed: ${e.message || e}`);
      }
    }
    setUploading(false);
    await logActivity(supabase, profile, {
      action: 'create',
      entityType: 'purchase',
      entityId: inserted?.id,
      description: `${profile?.name} added purchase of ${fmtMoney(amount)} from ${effectiveVendor?.name || 'unknown vendor'} for ${storeName} on ${shortDate(form.week_of)}`,
      storeName,
    });
    setModal(false);
    setInvoiceFile(null);
    setInvoicePreview(null);
    load();
  };

  const handleInvoicePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInvoiceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setInvoicePreview(ev.target.result);
    reader.readAsDataURL(file);
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

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const hasStore = !!effectiveStoreId;
  const storeName = stores.find(s => s.id === effectiveStoreId)?.name;

  const tryOpenAdd = () => {
    if (!hasStore) { setShowStorePicker(true); return; }
    setForm(blankForm());
    setModal(true);
  };

  return (<div>
    <PageHeader title="🛒 Product Buying" subtitle={hasStore ? storeName : 'All Stores (view only)'}>
      <Button variant="secondary" onClick={() => downloadCSV('purchases.csv', ['Week','Store','Item','Qty','Cost','Total','Vendor'], items.map(p => [p.week_of, p.stores?.name, p.item, p.quantity, p.unit_cost, p.total_cost, p.supplier]))} className="!text-[11px]">📥 CSV</Button>
      <Button onClick={tryOpenAdd}>+ Add</Button>
    </PageHeader>
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable
        emptyMessage="No purchases yet. Tap + Add to log an invoice."
        columns={[
          { key: 'week_of', label: 'Date', render: v => weekLabel(v) },
          ...(!effectiveStoreId ? [{ key: 'store_id', label: 'Store', render: (_,r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> }] : []),
          { key: 'supplier', label: 'Vendor', render: v => <span className="text-sw-text font-bold">{v || '—'}</span> },
          { key: 'total_cost', label: 'Amount', align: 'right', mono: true, render: v => <span className="text-sw-amber text-[14px] font-extrabold">{fmt(v)}</span> },
          { key: '_invoice', label: '🧾', align: 'center', render: (_, r) => {
            const inv = invoiceByPurchase[r.id];
            if (!inv) return <span className="text-sw-dim">—</span>;
            return (
              <button onClick={() => setViewInvoice(inv)} title="View invoice" className="text-sw-blue text-lg">🧾</button>
            );
          } },
          { key: 'notes', label: 'Notes', render: v => <span className="text-sw-sub text-[11px]">{v || '—'}</span> },
        ]}
        rows={items}
        isOwner={hasStore}
        onDelete={hasStore ? id => { const r = items.find(i => i.id === id); if (r) setConfirmDelete(r); } : undefined}
      />
    </div>
    {modal && <Modal title="Log Purchase" onClose={() => setModal(false)}>
      <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
        Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
      </div>

      <Field label="Date"><input type="date" value={form.week_of} onChange={e => setForm({...form, week_of: e.target.value})} /></Field>

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
          className="!text-[22px] !font-mono !font-extrabold !py-3 !text-sw-green"
        />
      </Field>

      <Field label="Invoice Image (optional)">
        {!invoicePreview ? (
          <label className="flex items-center justify-center gap-2 py-4 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[13px] font-semibold cursor-pointer min-h-[56px]">
            <span className="text-xl">📷</span>
            <span>Take photo or upload invoice</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleInvoicePick}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setViewInvoice({ image_url: invoicePreview, vendor_name: 'Preview', date: form.week_of, amount: parseFloat(form.amount) || 0 })}
              className="block w-full"
            >
              <img src={invoicePreview} alt="Invoice preview" className="max-h-[200px] w-full object-contain rounded-lg border border-sw-border bg-black/20" />
            </button>
            <div className="flex gap-2 items-center">
              <button
                type="button"
                onClick={() => { setInvoiceFile(null); setInvoicePreview(null); }}
                className="text-sw-red text-[11px] font-semibold border border-sw-red/30 rounded px-3 py-1.5 bg-sw-redD min-h-[32px]"
              >
                ✕ Remove
              </button>
              <span className="text-sw-dim text-[10px] truncate flex-1">{invoiceFile?.name}</span>
            </div>
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
        <Button variant="secondary" onClick={() => { setModal(false); setNewVendorName(''); setInvoiceFile(null); setInvoicePreview(null); }}>Cancel</Button>
        <Button onClick={handleSave} disabled={uploading}>{uploading ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>}
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
