'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, StatCard, Loading, StoreBadge, Alert } from '@/components/UI';
import { fmt, fK, downloadCSV, PRODUCT_CATEGORIES } from '@/lib/utils';
import { logActivity, fmtMoney } from '@/lib/activity';

export default function InventoryPage() {
  const { supabase, isOwner, profile } = useAuth();
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ store_id:'', name:'', category:PRODUCT_CATEGORIES[0], cost_price:'', sell_price:'', stock:'', reorder_level:'10', vendor_id:'' });

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [{ data: st }, { data: v }] = await Promise.all([
        supabase.from('stores').select('*').order('created_at'),
        supabase.from('vendors').select('*').order('name'),
      ]);
      setStores(st||[]); setVendors(v||[]);

      let q = supabase.from('inventory').select('*, stores(name, color), vendors(name)').eq('is_active', true).order('stock', { ascending: true });
      if (catFilter) q = q.eq('category', catFilter);
      if (search) q = q.ilike('name', `%${search}%`);
      const { data } = await q;
      setItems(data||[]);
      if (!form.store_id && st?.length) setForm(f => ({...f, store_id: st[0].id, vendor_id: v?.[0]?.id||''}));
    } catch (e) {
      console.error('[inventory] load failed:', e);
      setLoadError(e?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [catFilter, search]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const lowCount = items.filter(i => i.stock <= i.reorder_level).length;
  const totalValue = items.reduce((s,i) => s + i.stock * i.cost_price, 0);
  const totalRetail = items.reduce((s,i) => s + i.stock * i.sell_price, 0);
  const avgMargin = items.length ? items.reduce((s,i) => s + (i.sell_price > 0 ? (i.sell_price-i.cost_price)/i.sell_price*100 : 0), 0) / items.length : 0;

  return (<div>
    <PageHeader title="📦 Inventory" subtitle={`${items.length} products · ${lowCount} low stock`}>
      <Button variant="secondary" onClick={() => downloadCSV('inventory.csv', ['Store','Product','Category','Cost','Sell','Margin%','Stock','Reorder','Status'], items.map(i => [i.stores?.name, i.name, i.category, i.cost_price, i.sell_price, ((i.sell_price-i.cost_price)/i.sell_price*100).toFixed(1), i.stock, i.reorder_level, i.stock <= i.reorder_level ? 'LOW' : 'OK']))} className="!text-[11px]">📥 CSV</Button>
      <Button onClick={() => { setForm({ store_id: stores[0]?.id||'', name:'', category:PRODUCT_CATEGORIES[0], cost_price:'', sell_price:'', stock:'', reorder_level:'10', vendor_id: vendors[0]?.id||'' }); setModal('add'); }}>+ Add</Button>
    </PageHeader>
    {loadError && <Alert type="error">{loadError}</Alert>}
    <div className="flex gap-2.5 flex-wrap mb-3.5">
      <StatCard label="Cost Value" value={fK(totalValue)} icon="💵" color="#FBBF24" />
      <StatCard label="Retail Value" value={fK(totalRetail)} icon="🏷️" color="#34D399" />
      <StatCard label="Avg Margin" value={avgMargin.toFixed(1)+'%'} icon="📊" color={avgMargin > 40 ? '#34D399' : '#FBBF24'} />
      <StatCard label="Low Stock" value={lowCount} icon="⚠️" color={lowCount > 5 ? '#F87171' : '#FBBF24'} />
    </div>
    <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
      <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="!w-[200px] !py-1.5 !text-[11px]" />
      <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="!w-[160px] !py-1.5 !text-[11px]">
        <option value="">All Categories</option>
        {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'name', label: 'Product', render: (v,r) => <div><div className="font-semibold">{v}</div><div className="text-sw-dim text-[10px]">{r.category}</div></div> },
        { key: 'store_id', label: 'Store', render: (_,r) => <span className="text-[11px]">{r.stores?.name}</span> },
        { key: 'cost_price', label: 'Cost', align: 'right', mono: true, render: v => fmt(v) },
        { key: 'sell_price', label: 'Sell', align: 'right', mono: true, render: v => <span className="text-sw-green">{fmt(v)}</span> },
        { key: '_margin', label: 'Margin', align: 'right', mono: true, render: (_,r) => { const m = r.sell_price > 0 ? ((r.sell_price-r.cost_price)/r.sell_price*100) : 0; return <span className={m > 40 ? 'text-sw-green' : m > 20 ? 'text-sw-amber' : 'text-sw-red'}>{m.toFixed(0)}%</span>; } },
        { key: 'stock', label: 'Stock', align: 'right', mono: true, render: (v,r) => <span className={v <= 0 ? 'text-sw-red font-bold' : v <= r.reorder_level ? 'text-sw-amber font-bold' : ''}>{v}{v <= r.reorder_level && v > 0 ? ' ⚠️' : v <= 0 ? ' 🔴' : ''}</span> },
        { key: 'reorder_level', label: 'Reorder', align: 'right', mono: true },
      ]} rows={items} isOwner={true} onEdit={r => { setForm({ store_id: r.store_id, name: r.name, category: r.category||PRODUCT_CATEGORIES[0], cost_price: r.cost_price, sell_price: r.sell_price, stock: r.stock, reorder_level: r.reorder_level, vendor_id: r.vendor_id||'' }); setEditItem(r); setModal('edit'); }} />
    </div>
    {modal && <Modal title={modal==='edit'?'Edit Product':'Add Product'} onClose={() => { setModal(null); setEditItem(null); }}>
      <Field label="Store"><select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Product Name"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Elf Bar 5000" /></Field>
      <Field label="Category"><select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>{PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Cost Price"><input type="number" value={form.cost_price} onChange={e => setForm({...form, cost_price: e.target.value})} /></Field>
        <Field label="Sell Price"><input type="number" value={form.sell_price} onChange={e => setForm({...form, sell_price: e.target.value})} /></Field>
        <Field label="Stock"><input type="number" value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} /></Field>
        <Field label="Reorder Level"><input type="number" value={form.reorder_level} onChange={e => setForm({...form, reorder_level: e.target.value})} /></Field>
      </div>
      <Field label="Vendor"><select value={form.vendor_id} onChange={e => setForm({...form, vendor_id: e.target.value})}><option value="">None</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      {parseFloat(form.cost_price) > 0 && parseFloat(form.sell_price) > 0 && <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border"><span className="text-sw-sub text-[11px]">Margin: </span><span className="text-sw-green text-sm font-bold font-mono">{(((parseFloat(form.sell_price)-parseFloat(form.cost_price))/parseFloat(form.sell_price))*100).toFixed(1)}%</span></div>}
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); }}>Cancel</Button><Button onClick={async () => {
        const d = { ...form, cost_price: parseFloat(form.cost_price)||0, sell_price: parseFloat(form.sell_price)||0, stock: parseInt(form.stock)||0, reorder_level: parseInt(form.reorder_level)||10 };
        const wasEdit = modal === 'edit';
        const res = wasEdit
          ? await supabase.from('inventory').update(d).eq('id', editItem.id).select().single()
          : await supabase.from('inventory').insert(d).select().single();
        if (res.error) { alert(res.error.message); return; }
        const storeName = stores.find(s => s.id === d.store_id)?.name;
        await logActivity(supabase, profile, {
          action: wasEdit ? 'update' : 'create',
          entityType: 'inventory',
          entityId: res.data?.id,
          description: `${profile?.name} ${wasEdit ? 'updated' : 'added'} inventory "${d.name}" (stock ${d.stock}, cost ${fmtMoney(d.cost_price)}, sell ${fmtMoney(d.sell_price)}) at ${storeName}`,
          storeName,
          metadata: wasEdit ? { before: editItem, after: d } : null,
        });
        setModal(null); setEditItem(null); load();
      }}>{modal==='edit'?'Update':'Add'}</Button></div>
    </Modal>}
  </div>);
}
