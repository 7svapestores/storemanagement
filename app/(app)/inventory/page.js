'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, StatCard, Loading, StoreBadge, Alert, StoreRequiredModal } from '@/components/UI';
import { fmt, fK, downloadCSV, PRODUCT_CATEGORIES } from '@/lib/utils';
import { logActivity, fmtMoney } from '@/lib/activity';

export default function InventoryPage() {
  const { supabase, isOwner, isEmployee, profile, effectiveStoreId, setSelectedStore } = useAuth();
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [modal, setModal] = useState(null); // 'add' | 'edit' | 'stock'
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({
    store_id: '', name: '', category: PRODUCT_CATEGORIES[0],
    cost_price: '', sell_price: '', stock: '', reorder_level: '10', vendor_id: '',
  });
  const [stockForm, setStockForm] = useState({ stock: '' });

  // Employees are hard-scoped to their own store. Owners scope to their
  // sidebar-selected store (or see all when on "All Stores").
  const scopedStoreId = isEmployee ? profile?.store_id : effectiveStoreId;

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [{ data: st }, { data: v }] = await Promise.all([
        supabase.from('stores').select('*').order('created_at'),
        supabase.from('vendors').select('*').order('name'),
      ]);
      setStores(st || []);
      setVendors(v || []);

      let q = supabase.from('inventory')
        .select('*, stores(name, color), vendors(name)')
        .eq('is_active', true)
        .order('stock', { ascending: true });
      if (scopedStoreId) q = q.eq('store_id', scopedStoreId);
      if (catFilter) q = q.eq('category', catFilter);
      if (search) q = q.ilike('name', `%${search}%`);

      const { data, error } = await q;
      if (error) throw error;
      setItems(data || []);

      if (!form.store_id && st?.length) {
        setForm(f => ({ ...f, store_id: scopedStoreId || st[0].id, vendor_id: v?.[0]?.id || '' }));
      }
    } catch (e) {
      console.error('[inventory] load failed:', e);
      setLoadError(e?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [catFilter, search, scopedStoreId]);

  if (loading) return <Loading />;

  const lowCount = items.filter(i => i.stock <= i.reorder_level).length;

  // ── Owner-only stats (require prices) ──────────────────
  const totalValue = items.reduce((s, i) => s + i.stock * (i.cost_price || 0), 0);
  const totalRetail = items.reduce((s, i) => s + i.stock * (i.sell_price || 0), 0);
  const avgMargin = items.length
    ? items.reduce((s, i) => s + (i.sell_price > 0 ? (i.sell_price - i.cost_price) / i.sell_price * 100 : 0), 0) / items.length
    : 0;

  const currentStore = stores.find(s => s.id === scopedStoreId);

  // ── Save handlers ──────────────────────────────────────
  const saveFull = async () => {
    const d = {
      ...form,
      cost_price: parseFloat(form.cost_price) || 0,
      sell_price: parseFloat(form.sell_price) || 0,
      stock: parseInt(form.stock) || 0,
      reorder_level: parseInt(form.reorder_level) || 10,
    };
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
  };

  // Employee add/edit — limited fields; no price, no vendor, store auto-set.
  const saveEmployee = async () => {
    if (!profile?.store_id) { alert('Missing store assignment'); return; }
    const d = {
      store_id: profile.store_id,
      name: (form.name || '').trim(),
      category: form.category || PRODUCT_CATEGORIES[0],
      stock: parseInt(form.stock) || 0,
      reorder_level: parseInt(form.reorder_level) || 10,
    };
    if (!d.name) { alert('Product name is required'); return; }
    const wasEdit = modal === 'edit';
    const res = wasEdit
      ? await supabase.from('inventory').update({
          name: d.name, category: d.category, stock: d.stock, reorder_level: d.reorder_level,
        }).eq('id', editItem.id).select().single()
      : await supabase.from('inventory').insert({ ...d, cost_price: 0, sell_price: 0 }).select().single();
    if (res.error) { alert(res.error.message); return; }
    const storeName = currentStore?.name;
    await logActivity(supabase, profile, {
      action: wasEdit ? 'update' : 'create',
      entityType: 'inventory',
      entityId: res.data?.id,
      description: `${profile?.name} ${wasEdit ? 'updated' : 'added'} inventory "${d.name}" (stock ${d.stock}) at ${storeName}`,
      storeName,
      metadata: wasEdit ? { before: editItem, after: d } : null,
    });
    setModal(null); setEditItem(null); load();
  };

  // Quick stock-only update (employees and owners).
  const saveStockOnly = async () => {
    if (!editItem) return;
    const stock = parseInt(stockForm.stock);
    if (isNaN(stock) || stock < 0) { alert('Stock must be 0 or greater'); return; }
    const { error } = await supabase
      .from('inventory')
      .update({ stock })
      .eq('id', editItem.id);
    if (error) { alert(error.message); return; }
    await logActivity(supabase, profile, {
      action: 'update',
      entityType: 'inventory',
      entityId: editItem.id,
      description: `${profile?.name} updated stock for "${editItem.name}" from ${editItem.stock} to ${stock} at ${editItem.stores?.name}`,
      storeName: editItem.stores?.name,
      metadata: { before: { stock: editItem.stock }, after: { stock } },
    });
    setModal(null); setEditItem(null); setStockForm({ stock: '' }); load();
  };

  // ── Columns (differ for employee) ──────────────────────
  const baseColumns = [
    { key: 'name', label: 'Product', render: (v, r) => (
      <div>
        <div className="font-semibold">{v}</div>
        <div className="text-sw-dim text-[10px]">{r.category}</div>
      </div>
    ) },
  ];
  if (isOwner) {
    baseColumns.push({ key: 'store_id', label: 'Store', render: (_, r) => <span className="text-[11px]">{r.stores?.name}</span> });
    baseColumns.push({ key: 'cost_price', label: 'Cost', align: 'right', mono: true, render: v => fmt(v) });
    baseColumns.push({ key: 'sell_price', label: 'Sell', align: 'right', mono: true, render: v => <span className="text-sw-green">{fmt(v)}</span> });
    baseColumns.push({ key: '_margin', label: 'Margin', align: 'right', mono: true, render: (_, r) => {
      const m = r.sell_price > 0 ? ((r.sell_price - r.cost_price) / r.sell_price * 100) : 0;
      return <span className={m > 40 ? 'text-sw-green' : m > 20 ? 'text-sw-amber' : 'text-sw-red'}>{m.toFixed(0)}%</span>;
    } });
  }
  baseColumns.push({ key: 'stock', label: 'Stock', align: 'right', mono: true, render: (v, r) => (
    <span className={v <= 0 ? 'text-sw-red font-bold' : v <= r.reorder_level ? 'text-sw-amber font-bold' : ''}>
      {v}{v <= r.reorder_level && v > 0 ? ' ⚠️' : v <= 0 ? ' 🔴' : ''}
    </span>
  ) });
  baseColumns.push({ key: 'reorder_level', label: 'Reorder', align: 'right', mono: true });
  // Per-row quick "Update Stock" button (both roles).
  baseColumns.push({
    key: '_stock_action', label: '', align: 'right',
    render: (_, r) => (
      <button
        onClick={() => { setEditItem(r); setStockForm({ stock: String(r.stock) }); setModal('stock'); }}
        className="text-[10px] font-bold px-2 py-1 rounded bg-sw-blueD text-sw-blue border border-sw-blue/30 whitespace-nowrap"
      >
        Update Stock
      </button>
    ),
  });

  const openAdd = () => {
    // Owner must have a specific store selected to add inventory.
    if (isOwner && !scopedStoreId) { setShowStorePicker(true); return; }
    setForm({
      store_id: scopedStoreId || stores[0]?.id || '',
      name: '',
      category: PRODUCT_CATEGORIES[0],
      cost_price: '', sell_price: '',
      stock: '', reorder_level: '10',
      vendor_id: vendors[0]?.id || '',
    });
    setModal('add');
  };

  const openEditFull = (r) => {
    setForm({
      store_id: r.store_id,
      name: r.name,
      category: r.category || PRODUCT_CATEGORIES[0],
      cost_price: r.cost_price,
      sell_price: r.sell_price,
      stock: r.stock,
      reorder_level: r.reorder_level,
      vendor_id: r.vendor_id || '',
    });
    setEditItem(r);
    setModal('edit');
  };

  return (
    <div>
      <PageHeader
        title="📦 Inventory"
        subtitle={
          isEmployee && currentStore
            ? `${currentStore.name} · ${items.length} products · ${lowCount} low stock`
            : `${items.length} products · ${lowCount} low stock`
        }
      >
        {isOwner && (
          <Button
            variant="secondary"
            onClick={() => downloadCSV(
              'inventory.csv',
              ['Store','Product','Category','Cost','Sell','Margin%','Stock','Reorder','Status'],
              items.map(i => [
                i.stores?.name, i.name, i.category, i.cost_price, i.sell_price,
                i.sell_price > 0 ? ((i.sell_price - i.cost_price) / i.sell_price * 100).toFixed(1) : 0,
                i.stock, i.reorder_level, i.stock <= i.reorder_level ? 'LOW' : 'OK',
              ]),
            )}
            className="!text-[11px]"
          >
            📥 CSV
          </Button>
        )}
        <Button onClick={openAdd}>+ Add</Button>
      </PageHeader>

      {loadError && <Alert type="error">{loadError}</Alert>}

      {isOwner && (
        <div className="flex gap-2.5 flex-wrap mb-3.5">
          <StatCard label="Cost Value" value={fK(totalValue)} icon="💵" color="#FBBF24" />
          <StatCard label="Retail Value" value={fK(totalRetail)} icon="🏷️" color="#34D399" />
          <StatCard label="Avg Margin" value={avgMargin.toFixed(1) + '%'} icon="📊" color={avgMargin > 40 ? '#34D399' : '#FBBF24'} />
          <StatCard label="Low Stock" value={lowCount} icon="⚠️" color={lowCount > 5 ? '#F87171' : '#FBBF24'} />
        </div>
      )}

      {isEmployee && (
        <div className="flex gap-2.5 flex-wrap mb-3.5">
          <StatCard label="Products" value={items.length} icon="📦" color="#60A5FA" />
          <StatCard label="Low Stock" value={lowCount} icon="⚠️" color={lowCount > 5 ? '#F87171' : '#FBBF24'} />
        </div>
      )}

      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="!w-[200px] !py-1.5 !text-[11px]" />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="!w-[160px] !py-1.5 !text-[11px]">
          <option value="">All Categories</option>
          {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable
          emptyMessage={
            isEmployee
              ? 'No inventory yet for your store. Tap + Add to start tracking products.'
              : scopedStoreId
                ? 'Your inventory is empty. Add your products to track stock levels.'
                : 'Select a specific store from the sidebar to add or edit inventory.'
          }
          columns={baseColumns}
          rows={items}
          isOwner={isOwner}
          onEdit={isOwner ? openEditFull : undefined}
        />
      </div>

      {/* ── Add / Edit modal ─────────────────────── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'edit' ? 'Edit Product' : 'Add Product'} onClose={() => { setModal(null); setEditItem(null); }}>
          {isOwner ? (
            <>
              <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
                Store: <span className="text-sw-text font-semibold">{stores.find(s => s.id === form.store_id)?.name || '—'}</span>
              </div>
              <Field label="Product Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Elf Bar 5000" /></Field>
              <Field label="Category">
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Cost Price"><input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} /></Field>
                <Field label="Sell Price"><input type="number" value={form.sell_price} onChange={e => setForm({ ...form, sell_price: e.target.value })} /></Field>
                <Field label="Stock"><input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></Field>
                <Field label="Reorder Level"><input type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} /></Field>
              </div>
              <Field label="Vendor">
                <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                  <option value="">None</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              {parseFloat(form.cost_price) > 0 && parseFloat(form.sell_price) > 0 && (
                <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border">
                  <span className="text-sw-sub text-[11px]">Margin: </span>
                  <span className="text-sw-green text-sm font-bold font-mono">
                    {(((parseFloat(form.sell_price) - parseFloat(form.cost_price)) / parseFloat(form.sell_price)) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); }}>Cancel</Button>
                <Button onClick={saveFull}>{modal === 'edit' ? 'Update' : 'Add'}</Button>
              </div>
            </>
          ) : (
            // Employee-limited form: no prices, no vendor, no store picker.
            <>
              <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
                Store: <span className="text-sw-text font-semibold">{currentStore?.name || '—'}</span>
              </div>
              <Field label="Product Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Elf Bar 5000" /></Field>
              <Field label="Category">
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Stock on Hand"><input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></Field>
                <Field label="Reorder Level"><input type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} /></Field>
              </div>
              <p className="text-sw-dim text-[10px] mb-3">
                Prices are managed by the owner.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); }}>Cancel</Button>
                <Button onClick={saveEmployee}>{modal === 'edit' ? 'Update' : 'Add'}</Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {showStorePicker && (
        <StoreRequiredModal
          stores={stores}
          onCancel={() => setShowStorePicker(false)}
          onSelectStore={(s) => {
            setSelectedStore(s.id);
            setShowStorePicker(false);
            setForm({
              store_id: s.id,
              name: '',
              category: PRODUCT_CATEGORIES[0],
              cost_price: '', sell_price: '',
              stock: '', reorder_level: '10',
              vendor_id: vendors[0]?.id || '',
            });
            setModal('add');
          }}
        />
      )}

      {/* ── Stock-only quick update modal ─────────── */}
      {modal === 'stock' && editItem && (
        <Modal title="Update Stock" onClose={() => { setModal(null); setEditItem(null); setStockForm({ stock: '' }); }}>
          <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border">
            <div className="text-sw-text text-sm font-bold">{editItem.name}</div>
            <div className="text-sw-sub text-[11px]">{editItem.category} · Current stock: {editItem.stock}</div>
          </div>
          <Field label="New Stock Count">
            <input
              type="number" min="0"
              value={stockForm.stock}
              onChange={e => setStockForm({ stock: e.target.value.replace(/^-/, '') })}
              autoFocus
            />
          </Field>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); setStockForm({ stock: '' }); }}>Cancel</Button>
            <Button onClick={saveStockOnly}>Update Stock</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
