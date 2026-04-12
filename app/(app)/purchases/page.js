'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Loading, StoreBadge, ConfirmModal, StoreRequiredModal } from '@/components/UI';
import { fmt, weekLabel, today, downloadCSV } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

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
  const [form, setForm] = useState({ week_of: today(), item: '', quantity: '', unit_cost: '', vendor_id: '' });
  const [newVendorName, setNewVendorName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: st }, { data: v }] = await Promise.all([
        supabase.from('stores').select('*').order('created_at'),
        supabase.from('vendors').select('*').order('name'),
      ]);
      setStores(st || []); setVendors(v || []);

      let q = supabase.from('purchases')
        .select('*, stores(name, color)')
        .gte('week_of', range.start).lte('week_of', range.end)
        .order('week_of', { ascending: false });
      if (effectiveStoreId) q = q.eq('store_id', effectiveStoreId);
      const { data: p } = await q;
      setItems(p || []);

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

    const { data: inserted, error } = await supabase.from('purchases').insert(payload).select().single();
    if (error) { alert(error.message); return; }
    const storeName = stores.find(s => s.id === effectiveStoreId)?.name;
    await logActivity(supabase, profile, {
      action: 'create',
      entityType: 'purchase',
      entityId: inserted?.id,
      description: `${profile?.name} added purchase "${payload.item}" (${quantity} × ${fmtMoney(unit_cost)} = ${fmtMoney(total)}) for ${storeName} week of ${shortDate(form.week_of)} from ${effectiveVendor?.name || 'unknown vendor'}`,
      storeName,
    });
    setModal(false);
    load();
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
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => { setModal(false); setNewVendorName(''); }}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </Modal>}
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
