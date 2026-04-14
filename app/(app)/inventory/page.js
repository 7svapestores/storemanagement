'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Loading, Alert, Modal, Button, Field, ConfirmModal, EmptyState } from '@/components/UI';
import { today } from '@/lib/utils';

const DEPT_ICONS = {
  Vapes: '💨', 'Pre Rolls': '🚬', Hydroxy: '🧪', 'E-Liquids': '💧',
  Devices: '🔋', Gummies: '🍬', Kratom: '🌿', Novelty: '🎁', THCA: '🌱',
};

const productLabel = (p) => {
  const bits = [p.brand, p.name].filter(Boolean).join(' ');
  const extras = [p.flavor, p.size].filter(Boolean).join(' · ');
  return extras ? `${bits} — ${extras}` : bits;
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function statusLabel(s) {
  return {
    draft: '📝 In progress',
    submitted: '✅ Submitted',
    ordered: '📦 Ordered',
    received: '✔️ Received',
  }[s] || s || '—';
}
function statusPillClass(s) {
  return {
    draft: 'bg-sw-amberD text-sw-amber',
    submitted: 'bg-sw-greenD text-sw-green',
    ordered: 'bg-sw-blueD text-sw-blue',
    received: 'bg-sw-greenD text-sw-green',
  }[s] || 'bg-sw-card2 text-sw-sub';
}

export default function InventoryPage() {
  const { supabase, isOwner, isEmployee, profile, effectiveStoreId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stores, setStores] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [catalog, setCatalog] = useState([]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [{ data: storeRows }, { data: deptRows }, { data: prodRows }] = await Promise.all([
        supabase.from('stores').select('*').eq('is_active', true).order('name'),
        supabase.from('inventory_departments').select('*').order('sort_order', { ascending: true }),
        supabase.from('product_catalog').select('*').eq('is_active', true).order('brand'),
      ]);
      setStores(storeRows || []);
      setDepartments(deptRows || []);
      setCatalog(prodRows || []);
    } catch (e) {
      console.error('[inventory] base load failed:', e);
      setLoadError(e?.message || 'Failed to load inventory base data');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadBase(); }, [loadBase]);

  if (loading) return <Loading />;
  if (loadError) return <Alert type="error">{loadError}</Alert>;

  if (isEmployee) {
    return <EmployeeCountView
      supabase={supabase}
      profile={profile}
      storeId={effectiveStoreId}
      stores={stores}
      departments={departments}
      catalog={catalog}
    />;
  }

  return <OwnerView
    supabase={supabase}
    profile={profile}
    stores={stores}
    departments={departments}
    catalog={catalog}
    reloadCatalog={loadBase}
  />;
}

// ═════════════════════════════════════════════════════════════
// EMPLOYEE VIEW
// ═════════════════════════════════════════════════════════════
function EmployeeCountView({ supabase, profile, storeId, stores, departments, catalog }) {
  const [activeCount, setActiveCount] = useState(null);
  const [items, setItems] = useState({});
  const [history, setHistory] = useState([]);
  const [activeDept, setActiveDept] = useState(null);
  const [search, setSearch] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [viewSubmitted, setViewSubmitted] = useState(null);

  const storeName = stores.find(s => s.id === storeId)?.name || 'Your store';

  const hydrateCount = async (count) => {
    const { data: rows } = await supabase
      .from('inventory_count_items')
      .select('*')
      .eq('count_id', count.id);
    const map = {};
    (rows || []).forEach(r => {
      const key = r.product_id || `custom:${r.id}`;
      map[key] = { ...r, _key: key, _dirty: false };
    });
    setActiveCount(count);
    setItems(map);
  };

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const { data: open } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId)
        .eq('status', 'draft')
        .order('count_date', { ascending: false })
        .limit(1);
      if (open?.[0]) await hydrateCount(open[0]);
      const { data: hist } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId)
        .neq('status', 'draft')
        .order('count_date', { ascending: false })
        .limit(10);
      setHistory(hist || []);
    })();
  }, [storeId]);

  useEffect(() => {
    if (!activeDept && departments.length) setActiveDept(departments[0].id);
  }, [departments, activeDept]);

  const startCount = async () => {
    if (!storeId) return alert('No store assigned');
    setBusyMsg('Starting count…');
    const { data, error } = await supabase
      .from('inventory_counts')
      .insert({ store_id: storeId, count_date: today(), status: 'draft', created_by: profile?.id })
      .select().single();
    setBusyMsg('');
    if (error) return alert('Could not start count: ' + error.message);
    setActiveCount(data);
    setItems({});
  };

  const saveTimer = useRef(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const flushSave = async () => {
    if (!activeCount) return;
    const dirty = Object.values(itemsRef.current).filter(r => r._dirty);
    if (!dirty.length) return;
    setSaving(true);
    try {
      for (const row of dirty) {
        const payload = {
          count_id: activeCount.id,
          product_id: row.product_id || null,
          department_id: row.department_id,
          brand: row.brand || null,
          name: row.name || null,
          flavor: row.flavor || null,
          size: row.size || null,
          in_stock: num(row.in_stock),
          need_to_order: num(row.need_to_order),
          notes: row.notes || null,
          is_custom: !!row.is_custom,
        };
        if (row.id) {
          await supabase.from('inventory_count_items').update(payload).eq('id', row.id);
          setItems(prev => ({ ...prev, [row._key]: { ...prev[row._key], _dirty: false } }));
        } else {
          const { data } = await supabase.from('inventory_count_items').insert(payload).select().single();
          if (data) {
            setItems(prev => {
              const oldKey = row._key;
              const newKey = payload.product_id || `custom:${data.id}`;
              const next = { ...prev };
              delete next[oldKey];
              next[newKey] = { ...data, _key: newKey, _dirty: false };
              return next;
            });
          }
        }
      }
    } catch (e) {
      console.error('[inventory] autosave failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const markDirty = (key, patch) => {
    setItems(prev => {
      const cur = prev[key] || {};
      return { ...prev, [key]: { ...cur, ...patch, _key: key, _dirty: true } };
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const getRow = (product) => items[product.id] || {
    product_id: product.id,
    department_id: product.department_id,
    brand: product.brand, name: product.name, flavor: product.flavor, size: product.size,
    in_stock: '', need_to_order: '', notes: '', is_custom: false,
  };

  const submit = async () => {
    setConfirmSubmit(false);
    setBusyMsg('Submitting…');
    await flushSave();
    const { error } = await supabase
      .from('inventory_counts')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), submitted_by: profile?.id })
      .eq('id', activeCount.id);
    setBusyMsg('');
    if (error) return alert('Submit failed: ' + error.message);
    const submitted = { ...activeCount, status: 'submitted', submitted_at: new Date().toISOString() };
    setHistory(prev => [submitted, ...prev]);
    setActiveCount(null);
    setItems({});
  };

  const filteredCatalog = useMemo(() => {
    let list = catalog;
    if (activeDept) list = list.filter(p => p.department_id === activeDept);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => productLabel(p).toLowerCase().includes(q));
    }
    return list;
  }, [catalog, activeDept, search]);

  const customItemsForDept = useMemo(
    () => Object.values(items).filter(r => r.is_custom && r.department_id === activeDept),
    [items, activeDept]
  );

  if (!storeId) {
    return <Alert type="warning">No store assigned to your account. Ask the owner to assign one.</Alert>;
  }

  if (viewSubmitted) {
    return <SubmittedCountDetail
      supabase={supabase}
      count={viewSubmitted}
      departments={departments}
      onBack={() => setViewSubmitted(null)}
    />;
  }

  if (!activeCount) {
    return (
      <div>
        <PageHeader title="📦 Inventory Count" subtitle={storeName} />
        <div className="bg-sw-card border border-sw-border rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <div className="text-sw-text text-sm font-bold mb-1">No count in progress</div>
          <p className="text-sw-sub text-xs mb-4">Walk the store and tap start when you're ready.</p>
          <Button onClick={startCount}>Start Inventory Count</Button>
        </div>
        {busyMsg && <Alert type="info">{busyMsg}</Alert>}
        {history.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sw-text text-[13px] font-bold mb-2">Previous Counts</h3>
            <div className="space-y-1.5">
              {history.map(h => (
                <button key={h.id} onClick={() => setViewSubmitted(h)}
                  className="w-full flex items-center justify-between bg-sw-card border border-sw-border rounded-lg px-3 py-2.5 hover:border-sw-blue/40 transition-colors text-left">
                  <div>
                    <div className="text-sw-text text-[13px] font-bold">{h.count_date}</div>
                    <div className="text-sw-sub text-[11px]">{statusLabel(h.status)}</div>
                  </div>
                  <span className="text-sw-sub">›</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="📦 Inventory Count" subtitle={`${storeName} · ${activeCount.count_date}`}>
        <span className="text-[11px] text-sw-sub self-center">{saving ? '💾 Saving…' : 'Auto-saved'}</span>
        <Button variant="success" onClick={() => setConfirmSubmit(true)}>Submit</Button>
      </PageHeader>

      <div className="bg-sw-card border border-sw-border rounded-xl p-2 mb-3 overflow-x-auto">
        <div className="flex gap-1.5" style={{ minWidth: 'max-content' }}>
          {departments.map(d => (
            <button key={d.id} onClick={() => setActiveDept(d.id)}
              className={`px-3 py-2 rounded-lg text-[12px] font-bold whitespace-nowrap transition-colors ${
                activeDept === d.id ? 'bg-sw-blueD text-sw-blue border border-sw-blue/30' : 'bg-sw-card2 text-sw-sub border border-sw-border'
              }`}>
              {DEPT_ICONS[d.name] || '📦'} {d.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <input type="search" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="w-full" />
      </div>

      <div className="space-y-2">
        {filteredCatalog.length === 0 && customItemsForDept.length === 0 && (
          <div className="bg-sw-card border border-sw-border rounded-xl p-6 text-center text-sw-sub text-[12px]">
            No products in this department yet.
          </div>
        )}

        {filteredCatalog.map(p => {
          const row = getRow(p);
          return (
            <ProductRow key={p.id} label={productLabel(p)} row={row}
              onChange={(patch) => markDirty(p.id, { ...row, ...patch })} />
          );
        })}

        {customItemsForDept.map(row => (
          <ProductRow key={row._key} label={`${productLabel(row)} (custom)`} row={row}
            onChange={(patch) => markDirty(row._key, { ...row, ...patch })}
            onRemove={async () => {
              if (row.id) await supabase.from('inventory_count_items').delete().eq('id', row.id);
              setItems(prev => { const n = { ...prev }; delete n[row._key]; return n; });
            }} />
        ))}
      </div>

      <div className="mt-3">
        <Button variant="secondary" onClick={() => setShowCustom(true)}>+ Add Custom Product</Button>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="success" onClick={() => setConfirmSubmit(true)}>Submit Inventory Count</Button>
      </div>

      {showCustom && (
        <CustomProductModal
          departments={departments} defaultDept={activeDept}
          onClose={() => setShowCustom(false)}
          onAdd={(data) => {
            const tempKey = `custom:new:${Date.now()}`;
            markDirty(tempKey, { ...data, is_custom: true, product_id: null });
            setShowCustom(false);
            setActiveDept(data.department_id);
          }} />
      )}

      {confirmSubmit && (
        <ConfirmModal
          title="Submit Inventory Count?"
          message={`Submit inventory count for ${storeName}? This will notify the owner and lock the sheet — you won't be able to edit afterward.`}
          confirmLabel="Submit"
          confirmVariant="success"
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={submit} />
      )}

      {busyMsg && <Alert type="info">{busyMsg}</Alert>}
    </div>
  );
}

function ProductRow({ label, row, onChange, onRemove }) {
  return (
    <div className="bg-sw-card border border-sw-border rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-sw-text text-[13px] font-semibold flex-1">{label}</div>
        {onRemove && <button onClick={onRemove} className="text-sw-red text-[11px] font-semibold px-2">✕</button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sw-sub text-[9px] font-bold uppercase mb-1">In Stock</label>
          <input type="number" inputMode="numeric" pattern="[0-9]*"
            value={row.in_stock ?? ''} onChange={e => onChange({ in_stock: e.target.value })}
            className="w-full text-center font-mono text-base" style={{ height: 48 }} />
        </div>
        <div>
          <label className="block text-sw-sub text-[9px] font-bold uppercase mb-1">Need to Order</label>
          <input type="number" inputMode="numeric" pattern="[0-9]*"
            value={row.need_to_order ?? ''} onChange={e => onChange({ need_to_order: e.target.value })}
            className="w-full text-center font-mono text-base" style={{ height: 48 }} />
        </div>
      </div>
      <input type="text" placeholder="Notes (optional)" value={row.notes || ''}
        onChange={e => onChange({ notes: e.target.value })} className="w-full mt-2 text-[12px]" />
    </div>
  );
}

function CustomProductModal({ departments, defaultDept, onClose, onAdd }) {
  const [dept, setDept] = useState(defaultDept || departments[0]?.id || '');
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [flavor, setFlavor] = useState('');
  const [size, setSize] = useState('');
  const [inStock, setInStock] = useState('');
  const [order, setOrder] = useState('');

  const submit = () => {
    if (!dept || !name.trim()) return alert('Department and product name are required');
    onAdd({
      department_id: dept, brand: brand.trim(), name: name.trim(),
      flavor: flavor.trim(), size: size.trim(),
      in_stock: num(inStock), need_to_order: num(order), notes: '',
    });
  };

  return (
    <Modal title="Add Custom Product" onClose={onClose}>
      <Field label="Department">
        <select value={dept} onChange={e => setDept(e.target.value)} className="w-full">
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} /></Field>
      <Field label="Product Name *"><input value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Flavor"><input value={flavor} onChange={e => setFlavor(e.target.value)} /></Field>
      <Field label="Size"><input value={size} onChange={e => setSize(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="In Stock"><input type="number" inputMode="numeric" value={inStock} onChange={e => setInStock(e.target.value)} /></Field>
        <Field label="Need to Order"><input type="number" inputMode="numeric" value={order} onChange={e => setOrder(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>Add</Button>
      </div>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════
// OWNER VIEW
// ═════════════════════════════════════════════════════════════
function OwnerView({ supabase, profile, stores, departments, catalog, reloadCatalog }) {
  const [tab, setTab] = useState('status');
  const [counts, setCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCount, setSelectedCount] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('inventory_counts')
        .select('*')
        .order('count_date', { ascending: false })
        .limit(100);
      setCounts(data || []);
      setLoading(false);
    })();
  }, [supabase]);

  const latestByStore = useMemo(() => {
    const map = {};
    for (const c of counts) {
      if (!map[c.store_id] || c.count_date > map[c.store_id].count_date) map[c.store_id] = c;
    }
    return map;
  }, [counts]);

  if (selectedCount) {
    return <OwnerOrderSheet
      supabase={supabase} count={selectedCount}
      store={stores.find(s => s.id === selectedCount.store_id)}
      departments={departments}
      onBack={() => setSelectedCount(null)}
      onChanged={(updated) => {
        setCounts(prev => prev.map(c => c.id === updated.id ? updated : c));
        setSelectedCount(updated);
      }} />;
  }

  return (
    <div>
      <PageHeader title="📦 Inventory & Orders" />
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        <TabBtn active={tab === 'status'} onClick={() => setTab('status')}>Store Status</TabBtn>
        <TabBtn active={tab === 'combined'} onClick={() => setTab('combined')}>Combined Order</TabBtn>
        <TabBtn active={tab === 'catalog'} onClick={() => setTab('catalog')}>Manage Products</TabBtn>
      </div>

      {loading && <Loading />}

      {!loading && tab === 'status' && (
        <StoreStatusList stores={stores} latestByStore={latestByStore} counts={counts} onOpen={setSelectedCount} />
      )}

      {!loading && tab === 'combined' && (
        <CombinedOrderSheet
          supabase={supabase} stores={stores} departments={departments}
          counts={counts.filter(c => c.status === 'submitted' || c.status === 'ordered')} />
      )}

      {tab === 'catalog' && (
        <CatalogManager supabase={supabase} departments={departments}
          catalog={catalog} profile={profile} onChanged={reloadCatalog} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2 rounded-lg text-[12px] font-bold whitespace-nowrap transition-colors ${
        active ? 'bg-sw-blueD text-sw-blue border border-sw-blue/30' : 'bg-sw-card2 text-sw-sub border border-sw-border'
      }`}>
      {children}
    </button>
  );
}

function StoreStatusList({ stores, latestByStore, counts, onOpen }) {
  return (
    <div className="space-y-2">
      {stores.map(st => {
        const latest = latestByStore[st.id];
        const storeCounts = counts.filter(c => c.store_id === st.id);
        return (
          <div key={st.id} className="bg-sw-card border border-sw-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-sm" style={{ background: st.color }} />
                <span className="text-sw-text text-sm font-bold">{st.name}</span>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${statusPillClass(latest?.status)}`}>
                {latest ? statusLabel(latest.status) : 'No count yet'}
              </span>
            </div>
            <div className="text-sw-sub text-[11px] mb-3">
              {latest ? `Last count: ${latest.count_date}` : '—'}
            </div>
            {storeCounts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {storeCounts.slice(0, 6).map(c => (
                  <button key={c.id} onClick={() => onOpen(c)}
                    className="text-[11px] px-2.5 py-1.5 rounded-md bg-sw-card2 border border-sw-border hover:border-sw-blue/40 text-sw-text font-semibold">
                    {c.count_date} · {statusLabel(c.status)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OwnerOrderSheet({ supabase, count, store, departments, onBack, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittedBy, setSubmittedBy] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('inventory_count_items').select('*').eq('count_id', count.id);
      setItems(data || []);
      if (count.submitted_by) {
        const { data: p } = await supabase.from('profiles').select('name').eq('id', count.submitted_by).maybeSingle();
        setSubmittedBy(p?.name || '');
      }
      setLoading(false);
    })();
  }, [count.id]);

  const byDept = useMemo(() => {
    const orderItems = items.filter(i => num(i.need_to_order) > 0);
    const groups = {};
    for (const d of departments) groups[d.id] = [];
    for (const it of orderItems) {
      if (!groups[it.department_id]) groups[it.department_id] = [];
      groups[it.department_id].push(it);
    }
    return groups;
  }, [items, departments]);

  const exportCsv = () => {
    const lines = [['Department', 'Brand', 'Product', 'Flavor', 'Size', 'In Stock', 'Need to Order', 'Notes']];
    for (const d of departments) {
      for (const it of byDept[d.id] || []) {
        lines.push([d.name, it.brand || '', it.name || '', it.flavor || '', it.size || '', num(it.in_stock), num(it.need_to_order), it.notes || '']);
      }
    }
    downloadCsv(`order-${store?.name || 'store'}-${count.count_date}.csv`, lines);
  };

  const exportXlsx = async () => {
    const XLSX = await import('xlsx');
    const rows = [['Department', 'Brand', 'Product', 'Flavor', 'Size', 'In Stock', 'Need to Order', 'Notes']];
    for (const d of departments) {
      for (const it of byDept[d.id] || []) {
        rows.push([d.name, it.brand || '', it.name || '', it.flavor || '', it.size || '', num(it.in_stock), num(it.need_to_order), it.notes || '']);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Order Sheet');
    XLSX.writeFile(wb, `order-${store?.name || 'store'}-${count.count_date}.xlsx`);
  };

  const setStatus = async (status) => {
    const patch = { status };
    if (status === 'ordered') patch.ordered_at = new Date().toISOString();
    if (status === 'received') patch.received_at = new Date().toISOString();
    const { data, error } = await supabase.from('inventory_counts').update(patch).eq('id', count.id).select().single();
    if (error) return alert('Update failed: ' + error.message);
    onChanged(data);
  };

  const totalItems = Object.values(byDept).reduce((s, arr) => s + arr.length, 0);

  return (
    <div>
      <button onClick={onBack} className="text-sw-sub text-[12px] mb-2">‹ Back</button>
      <PageHeader
        title={`Order Sheet — ${store?.name || ''}`}
        subtitle={`${count.count_date} · ${submittedBy ? `Submitted by ${submittedBy} · ` : ''}${statusLabel(count.status)}`}>
        <Button variant="secondary" onClick={exportCsv}>CSV</Button>
        <Button variant="secondary" onClick={exportXlsx}>Excel</Button>
        {count.status === 'submitted' && <Button onClick={() => setStatus('ordered')}>Mark Ordered</Button>}
        {count.status === 'ordered' && <Button variant="success" onClick={() => setStatus('received')}>Mark Received</Button>}
      </PageHeader>

      {loading ? <Loading /> : totalItems === 0 ? (
        <EmptyState icon="✅" title="Nothing to order" message="Every product is stocked. Nice." />
      ) : (
        <div className="space-y-3">
          {departments.map(d => {
            const list = byDept[d.id];
            if (!list?.length) return null;
            return (
              <div key={d.id} className="bg-sw-card border border-sw-border rounded-xl p-4">
                <h3 className="text-sw-text text-sm font-bold mb-3">
                  {DEPT_ICONS[d.name] || '📦'} {d.name}
                  <span className="text-sw-sub text-[11px] font-semibold ml-2">({list.length} items)</span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Product</th>
                        <th style={{ textAlign: 'right' }}>Stock</th>
                        <th style={{ textAlign: 'right' }}>Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(it => (
                        <tr key={it.id}>
                          <td>
                            <div className="text-sw-text text-[12px] font-semibold">{productLabel(it)}</div>
                            {it.notes && <div className="text-sw-dim text-[10px]">{it.notes}</div>}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-[12px]">{num(it.in_stock)}</td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-sw-green font-bold text-[12px]">{num(it.need_to_order)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubmittedCountDetail({ supabase, count, departments, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('inventory_count_items').select('*').eq('count_id', count.id);
      setItems(data || []);
      setLoading(false);
    })();
  }, [count.id]);

  const byDept = useMemo(() => {
    const m = {};
    for (const d of departments) m[d.id] = [];
    for (const it of items) {
      if (!m[it.department_id]) m[it.department_id] = [];
      m[it.department_id].push(it);
    }
    return m;
  }, [items, departments]);

  return (
    <div>
      <button onClick={onBack} className="text-sw-sub text-[12px] mb-2">‹ Back</button>
      <PageHeader title={`Count · ${count.count_date}`} subtitle={statusLabel(count.status)} />
      {loading ? <Loading /> : (
        <div className="space-y-3">
          {departments.map(d => {
            const list = byDept[d.id];
            if (!list?.length) return null;
            return (
              <div key={d.id} className="bg-sw-card border border-sw-border rounded-xl p-4">
                <h3 className="text-sw-text text-sm font-bold mb-2">{DEPT_ICONS[d.name] || '📦'} {d.name}</h3>
                {list.map(it => (
                  <div key={it.id} className="flex justify-between text-[12px] border-t border-sw-border py-1.5">
                    <span className="text-sw-text">{productLabel(it)}</span>
                    <span className="text-sw-sub font-mono">
                      {num(it.in_stock)} in · <span className="text-sw-green font-bold">{num(it.need_to_order)} order</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CombinedOrderSheet({ supabase, stores, departments, counts }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = counts.map(c => c.id).join(',');

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (!counts.length) { setItems([]); setLoading(false); return; }
      const latestByStore = {};
      for (const c of counts) {
        if (!latestByStore[c.store_id] || c.count_date > latestByStore[c.store_id].count_date) {
          latestByStore[c.store_id] = c;
        }
      }
      const ids = Object.values(latestByStore).map(c => c.id);
      const { data } = await supabase
        .from('inventory_count_items')
        .select('*, inventory_counts!inner(store_id)')
        .in('count_id', ids);
      const withStore = (data || []).map(r => ({ ...r, store_id: r.inventory_counts?.store_id }));
      setItems(withStore);
      setLoading(false);
    })();
  }, [key]);

  const combined = useMemo(() => {
    const groups = {};
    for (const it of items) {
      if (num(it.need_to_order) <= 0) continue;
      const k = it.product_id || `${it.brand}|${it.name}|${it.flavor}|${it.size}`;
      if (!groups[k]) {
        groups[k] = {
          key: k, department_id: it.department_id,
          brand: it.brand, name: it.name, flavor: it.flavor, size: it.size,
          total: 0, breakdown: [],
        };
      }
      groups[k].total += num(it.need_to_order);
      groups[k].breakdown.push({ store_id: it.store_id, qty: num(it.need_to_order) });
    }
    return Object.values(groups);
  }, [items]);

  const byDept = useMemo(() => {
    const g = {};
    for (const d of departments) g[d.id] = [];
    for (const c of combined) {
      if (!g[c.department_id]) g[c.department_id] = [];
      g[c.department_id].push(c);
    }
    return g;
  }, [combined, departments]);

  const exportCsv = () => {
    const lines = [['Department', 'Brand', 'Product', 'Flavor', 'Size', 'Total Order Qty']];
    for (const d of departments) {
      for (const it of byDept[d.id] || []) {
        lines.push([d.name, it.brand || '', it.name || '', it.flavor || '', it.size || '', it.total]);
      }
    }
    downloadCsv(`combined-order-${today()}.csv`, lines);
  };

  if (loading) return <Loading />;
  if (!combined.length) return <EmptyState icon="📭" title="No items to combine" message="No submitted counts with outstanding orders." />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="secondary" onClick={exportCsv}>Download CSV</Button>
      </div>
      <div className="space-y-3">
        {departments.map(d => {
          const list = byDept[d.id];
          if (!list?.length) return null;
          return (
            <div key={d.id} className="bg-sw-card border border-sw-border rounded-xl p-4">
              <h3 className="text-sw-text text-sm font-bold mb-3">
                {DEPT_ICONS[d.name] || '📦'} {d.name}
                <span className="text-sw-sub text-[11px] font-semibold ml-2">({list.length} items)</span>
              </h3>
              {list.map(it => (
                <div key={it.key} className="border-t border-sw-border py-2 text-[12px]">
                  <div className="flex justify-between">
                    <span className="text-sw-text font-semibold">{productLabel(it)}</span>
                    <span className="font-mono font-bold text-sw-green">Order {it.total}</span>
                  </div>
                  <div className="text-sw-dim text-[10px] mt-0.5">
                    {it.breakdown.map((b, i) => {
                      const st = stores.find(s => s.id === b.store_id);
                      return (
                        <span key={i}>{i > 0 && ' + '}{(st?.name || 'Store')}: {b.qty}</span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Catalog manager (owner)
// ─────────────────────────────────────────────────────────────
function CatalogManager({ supabase, departments, catalog, profile, onChanged }) {
  const [activeDept, setActiveDept] = useState(departments[0]?.id || null);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState('');
  const [pendingCustoms, setPendingCustoms] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('inventory_count_items')
        .select('*')
        .eq('is_custom', true)
        .is('product_id', null)
        .limit(200);
      setPendingCustoms(data || []);
    })();
  }, [catalog]);

  const list = useMemo(() => {
    let l = catalog;
    if (activeDept) l = l.filter(p => p.department_id === activeDept);
    if (search.trim()) {
      const q = search.toLowerCase();
      l = l.filter(p => productLabel(p).toLowerCase().includes(q));
    }
    return l;
  }, [catalog, activeDept, search]);

  const save = async (data) => {
    const payload = {
      department_id: data.department_id,
      brand: data.brand?.trim() || null,
      name: data.name?.trim(),
      flavor: data.flavor?.trim() || null,
      size: data.size?.trim() || null,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      await supabase.from('product_catalog').update(payload).eq('id', data.id);
    } else {
      await supabase.from('product_catalog').insert({ ...payload, created_by: profile?.id });
    }
    setEditItem(null);
    onChanged();
  };

  const deactivate = async (id) => {
    await supabase.from('product_catalog').update({ is_active: false }).eq('id', id);
    onChanged();
  };

  const approvePending = async (row) => {
    const payload = {
      department_id: row.department_id,
      brand: row.brand || null,
      name: row.name,
      flavor: row.flavor || null,
      size: row.size || null,
      is_active: true,
      created_by: profile?.id,
    };
    const { data } = await supabase.from('product_catalog').insert(payload).select().single();
    if (data) {
      await supabase.from('inventory_count_items')
        .update({ product_id: data.id, is_custom: false }).eq('id', row.id);
    }
    setPendingCustoms(prev => prev.filter(p => p.id !== row.id));
    onChanged();
  };

  const rejectPending = (row) => {
    setPendingCustoms(prev => prev.filter(p => p.id !== row.id));
  };

  return (
    <div>
      {pendingCustoms.length > 0 && (
        <div className="bg-sw-amberD border border-sw-amber/30 rounded-xl p-3 mb-3">
          <div className="text-sw-amber text-[11px] font-bold uppercase mb-2">
            {pendingCustoms.length} custom product{pendingCustoms.length > 1 ? 's' : ''} awaiting review
          </div>
          <div className="space-y-1.5">
            {pendingCustoms.map(row => (
              <div key={row.id} className="flex items-center justify-between gap-2 bg-sw-card2 rounded-md p-2">
                <div className="text-sw-text text-[12px] font-semibold flex-1">{productLabel(row)}</div>
                <button onClick={() => approvePending(row)} className="text-sw-green text-[11px] font-bold px-2">Approve</button>
                <button onClick={() => rejectPending(row)} className="text-sw-red text-[11px] font-bold px-2">Dismiss</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {departments.map(d => (
          <button key={d.id} onClick={() => setActiveDept(d.id)}
            className={`px-3 py-2 rounded-lg text-[12px] font-bold whitespace-nowrap ${
              activeDept === d.id ? 'bg-sw-blueD text-sw-blue border border-sw-blue/30' : 'bg-sw-card2 text-sw-sub border border-sw-border'
            }`}>
            {DEPT_ICONS[d.name] || '📦'} {d.name}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        <input type="search" placeholder="Search catalog…" value={search}
          onChange={e => setSearch(e.target.value)} className="flex-1" />
        <Button onClick={() => setEditItem({ department_id: activeDept, is_active: true })}>+ Add</Button>
      </div>

      <div className="bg-sw-card border border-sw-border rounded-xl divide-y divide-sw-border">
        {list.length === 0 && <div className="p-6 text-center text-sw-sub text-[12px]">No products</div>}
        {list.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2 p-3">
            <div className="text-sw-text text-[12px] font-semibold flex-1">{productLabel(p)}</div>
            <button onClick={() => setEditItem(p)} className="text-sw-blue text-[11px] font-bold px-2">Edit</button>
            <button onClick={() => deactivate(p.id)} className="text-sw-red text-[11px] font-bold px-2">Deactivate</button>
          </div>
        ))}
      </div>

      {editItem && (
        <ProductEditModal departments={departments} item={editItem}
          onClose={() => setEditItem(null)} onSave={save} />
      )}
    </div>
  );
}

function ProductEditModal({ departments, item, onClose, onSave }) {
  const [form, setForm] = useState({
    id: item.id,
    department_id: item.department_id || departments[0]?.id,
    brand: item.brand || '',
    name: item.name || '',
    flavor: item.flavor || '',
    size: item.size || '',
    is_active: item.is_active ?? true,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal title={item.id ? 'Edit Product' : 'Add Product'} onClose={onClose}>
      <Field label="Department">
        <select value={form.department_id || ''} onChange={e => set('department_id', e.target.value)} className="w-full">
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Brand"><input value={form.brand} onChange={e => set('brand', e.target.value)} /></Field>
      <Field label="Product Name *"><input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="Flavor"><input value={form.flavor} onChange={e => set('flavor', e.target.value)} /></Field>
      <Field label="Size"><input value={form.size} onChange={e => set('size', e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => form.name?.trim() && onSave(form)}>Save</Button>
      </div>
    </Modal>
  );
}
