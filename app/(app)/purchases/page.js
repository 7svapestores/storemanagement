'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Loading, StoreBadge } from '@/components/UI';
import { fmt, weekLabel, today, downloadCSV, PRODUCT_CATEGORIES } from '@/lib/utils';

export default function PurchasesPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ store_id: '', week_of: today(), item: '', category: PRODUCT_CATEGORIES[0], quantity: '', unit_cost: '', supplier: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: st }, { data: v }, { data: p }] = await Promise.all([
      supabase.from('stores').select('*').order('created_at'),
      supabase.from('vendors').select('*').order('name'),
      supabase.from('purchases').select('*, stores(name, color)').gte('week_of', range.start).lte('week_of', range.end).order('week_of', { ascending: false }),
    ]);
    setStores(st||[]); setVendors(v||[]); setItems(p||[]);
    if (!form.store_id && st?.length) setForm(f => ({...f, store_id: st[0].id, supplier: v?.[0]?.name||''}));
    setLoading(false);
  }, [range.start, range.end]);
  useEffect(() => { load(); }, [load]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  return (<div>
    <PageHeader title="🛒 Purchases">
      <Button variant="secondary" onClick={() => downloadCSV('purchases.csv', ['Week','Store','Item','Category','Qty','Cost','Total','Vendor'], items.map(p => [p.week_of, p.stores?.name, p.item, p.category, p.quantity, p.unit_cost, p.total_cost, p.supplier]))} className="!text-[11px]">📥 CSV</Button>
      <Button onClick={() => { setForm({ store_id: stores[0]?.id||'', week_of: today(), item: '', category: PRODUCT_CATEGORIES[0], quantity: '', unit_cost: '', supplier: vendors[0]?.name||'' }); setModal(true); }}>+ Add</Button>
    </PageHeader>
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'week_of', label: 'Week', render: v => weekLabel(v) },
        { key: 'store_id', label: 'Store', render: (_,r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
        { key: 'item', label: 'Item' },
        { key: 'category', label: 'Cat', render: v => <span className="text-sw-sub text-[11px]">{v||'—'}</span> },
        { key: 'quantity', label: 'Qty', align: 'right', mono: true },
        { key: 'unit_cost', label: 'Cost', align: 'right', mono: true, render: v => fmt(v) },
        { key: 'total_cost', label: 'Total', align: 'right', mono: true, render: v => <span className="text-sw-amber font-semibold">{fmt(v)}</span> },
        { key: 'supplier', label: 'Vendor' },
      ]} rows={items} isOwner={true} onDelete={async id => { await supabase.from('purchases').delete().eq('id', id); load(); }} />
    </div>
    {modal && <Modal title="Add Purchase" onClose={() => setModal(false)}>
      <Field label="Store"><select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Week Of"><input type="date" value={form.week_of} onChange={e => setForm({...form, week_of: e.target.value})} /></Field>
      <Field label="Item"><input value={form.item} onChange={e => setForm({...form, item: e.target.value})} placeholder="e.g. Elf Bar 5000" /></Field>
      <Field label="Category"><select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>{PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Qty"><input type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} /></Field>
        <Field label="Unit Cost"><input type="number" value={form.unit_cost} onChange={e => setForm({...form, unit_cost: e.target.value})} /></Field>
      </div>
      <Field label="Vendor"><select value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})}>{vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}</select></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={async () => {
        const { error } = await supabase.from('purchases').insert({ ...form, quantity: parseInt(form.quantity)||0, unit_cost: parseFloat(form.unit_cost)||0 });
        if (error) { alert(error.message); return; }
        setModal(false); load();
      }}>Save</Button></div>
    </Modal>}
  </div>);
}
