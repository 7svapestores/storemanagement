'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Loading, StoreBadge, ConfirmModal, StoreRequiredModal } from '@/components/UI';
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
  const [form, setForm] = useState({ week_of: today(), item: '', quantity: '', unit_cost: '', vendor_id: '' });
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
    const quantity = parseInt(form.quantity) || 0;
    const unit_cost = parseFloat(form.unit_cost) || 0;
    const total = quantity * unit_cost;
    const vendor = vendors.find(v => v.id === form.vendor_id);

    if (!effectiveStoreId) { alert('Select a store from the sidebar first.'); return; }
    if (!(form.item || '').trim()) { alert('Item name is required'); return; }
    if (quantity <= 0) { alert('Quantity must be greater than 0'); return; }
    if (unit_cost <= 0) { alert('Unit cost must be greater than 0'); return; }
    if (!form.vendor_id) { alert('Select a vendor'); return; }

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

    const payload = {
      store_id: effectiveStoreId,
      week_of: form.week_of,
      item: form.item.trim(),
      quantity,
      unit_cost,
      vendor_id: effectiveVendorId,
      supplier: effectiveVendor?.name || '',
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
          amount: total,
          notes: payload.item,
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
      description: `${profile?.name} added purchase "${payload.item}" (${quantity} × ${fmtMoney(unit_cost)} = ${fmtMoney(total)}) for ${storeName} week of ${shortDate(form.week_of)} from ${effectiveVendor?.name || 'unknown vendor'}`,
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
    const { error } = await supabase.from('purchases').delete().eq('id', row.id);
    if (error) { alert(error.message); setConfirmDelete(null); return; }
    await logActivity(supabase, profile, {
      action: 'delete',
      entityType: 'purchase',
      entityId: row.id,
      description: `${profile?.name} deleted purchase "${row.item}" of ${fmtMoney(row.total_cost)} for ${row.stores?.name} week of ${shortDate(row.week_of)}`,
      storeName: row.stores?.name,
      metadata: { deleted: row },
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
    setForm({ week_of: today(), item: '', quantity: '', unit_cost: '', vendor_id: vendors[0]?.id || '' });
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
        emptyMessage="No purchases yet. Start tracking what you buy for each store."
        columns={[
          { key: 'week_of', label: 'Week', render: v => weekLabel(v) },
          { key: 'store_id', label: 'Store', render: (_,r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
          { key: 'item', label: 'Item' },
          { key: 'quantity', label: 'Qty', align: 'right', mono: true },
          { key: 'unit_cost', label: 'Cost', align: 'right', mono: true, render: v => fmt(v) },
          { key: 'total_cost', label: 'Total', align: 'right', mono: true, render: v => <span className="text-sw-amber font-semibold">{fmt(v)}</span> },
          { key: 'supplier', label: 'Vendor' },
          { key: '_invoice', label: '🧾', align: 'center', render: (_, r) => {
            const inv = invoiceByPurchase[r.id];
            if (!inv) return <span className="text-sw-dim">—</span>;
            return (
              <button onClick={() => setViewInvoice(inv)} title="View invoice" className="text-sw-blue text-base">🧾</button>
            );
          } },
        ]} rows={items} isOwner={hasStore} onDelete={hasStore ? id => { const r = items.find(i => i.id === id); if (r) setConfirmDelete(r); } : undefined} />
    </div>
    {modal && <Modal title="Add Purchase" onClose={() => setModal(false)}>
      <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
        Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
      </div>
      <Field label="Week Of"><input type="date" value={form.week_of} onChange={e => setForm({...form, week_of: e.target.value})} /></Field>
      <Field label="Item"><input value={form.item} onChange={e => setForm({...form, item: e.target.value})} placeholder="e.g. Elf Bar 5000" /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Qty"><input type="number" min="1" step="1" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value.replace(/^-/, '')})} /></Field>
        <Field label="Unit Cost"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.unit_cost} onChange={e => setForm({...form, unit_cost: e.target.value.replace(/^-/, '')})} /></Field>
      </div>
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
      <Field label="Invoice Image (optional)">
        {!invoicePreview ? (
          <label className="flex items-center justify-center gap-2 py-3 px-3 rounded-lg border border-dashed border-sw-border bg-sw-card2 text-sw-sub text-[12px] cursor-pointer min-h-[44px]">
            <span>📷</span><span>Take photo or choose file</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleInvoicePick}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-2">
            <img src={invoicePreview} alt="Invoice preview" className="max-h-48 w-full object-contain rounded-lg border border-sw-border bg-black/20" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setInvoiceFile(null); setInvoicePreview(null); }}
                className="text-sw-red text-[11px] font-semibold border border-sw-red/30 rounded px-2 py-1 bg-sw-redD"
              >
                Remove
              </button>
              <span className="text-sw-dim text-[10px] self-center">{invoiceFile?.name}</span>
            </div>
          </div>
        )}
      </Field>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => { setModal(false); setNewVendorName(''); setInvoiceFile(null); setInvoicePreview(null); }}>Cancel</Button>
        <Button onClick={handleSave} disabled={uploading}>{uploading ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>}
    {viewInvoice && (
      <Modal title="Invoice" onClose={() => setViewInvoice(null)} wide>
        <div className="text-sw-sub text-[11px] mb-2">
          {viewInvoice.vendor_name} · {viewInvoice.date} · {fmtMoney(viewInvoice.amount)}
        </div>
        <img src={viewInvoice.image_url} alt="Invoice" className="w-full max-h-[70vh] object-contain rounded-lg border border-sw-border bg-black/30" />
        <div className="flex justify-end mt-3">
          <a href={viewInvoice.image_url} target="_blank" rel="noreferrer" className="text-sw-blue text-[11px] underline">Open original</a>
        </div>
      </Modal>
    )}
    {showStorePicker && (
      <StoreRequiredModal
        stores={stores}
        onCancel={() => setShowStorePicker(false)}
        onSelectStore={(s) => {
          setSelectedStore(s.id);
          setShowStorePicker(false);
          setForm({ week_of: today(), item: '', quantity: '', unit_cost: '', vendor_id: vendors[0]?.id || '' });
          setModal(true);
        }}
      />
    )}
    {confirmDelete && (
      <ConfirmModal
        title="Delete this purchase?"
        message={`Are you sure? This will be logged in the activity trail. Deleting "${confirmDelete.item}" of ${fmtMoney(confirmDelete.total_cost)} for ${confirmDelete.stores?.name || 'store'}.`}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    )}
  </div>);
}
