'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Loading, Alert, Button, Field, ConfirmModal, EmptyState, StoreBadge } from '@/components/UI';
import { today, downloadCSV } from '@/lib/utils';

const DEPT_ICONS = {
  Vapes: '💨', 'Pre Rolls': '🚬', Hydroxy: '🧪', 'E-Liquids': '💧',
  Devices: '🔋', Gummies: '🍬', Kratom: '🌿', Novelty: '🎁', THCA: '🌱',
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const inputClass = 'w-full px-3 py-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] text-[15px] focus:outline-none focus:border-sw-blue min-h-[48px]';

export default function InventoryPage() {
  const { supabase, isOwner, isEmployee, profile, effectiveStoreId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [stores, setStores] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [brands, setBrands] = useState([]);
  const [flavors, setFlavors] = useState([]);

  const loadDepartments = useCallback(async () => {
    const { data, error } = await supabase
      .from('inventory_departments')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    setDepartments(data || []);
    return data || [];
  }, [supabase]);

  const loadCatalog = useCallback(async () => {
    const [{ data: brandRows }, { data: flavorRows }] = await Promise.all([
      supabase.from('product_brands').select('id, department_id, name').order('name'),
      supabase.from('product_flavors').select('id, brand_id, name').order('name'),
    ]);
    setBrands(brandRows || []);
    setFlavors(flavorRows || []);
  }, [supabase]);

  const loadBase = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [{ data: storeRows }] = await Promise.all([
        supabase.from('stores').select('*').eq('is_active', true).order('name'),
        loadDepartments(),
        loadCatalog(),
      ]);
      setStores(storeRows || []);
    } catch (e) {
      console.error('[inventory] load failed:', e);
      setLoadError(e?.message || 'Failed to load inventory');
    } finally { setLoading(false); }
  }, [supabase, loadDepartments, loadCatalog]);

  useEffect(() => { loadBase(); }, [loadBase]);

  if (loading) return <Loading />;
  if (loadError) return <Alert type="error">{loadError}</Alert>;

  // Both owner and employee see the count form when a specific store is active.
  // Owner with "All Stores" (effectiveStoreId = null) sees the summary view.
  if (effectiveStoreId) {
    return <CountView
      supabase={supabase}
      profile={profile}
      isOwner={isOwner}
      storeId={effectiveStoreId}
      stores={stores}
      departments={departments}
      brands={brands}
      flavors={flavors}
      onCategoryAdded={loadDepartments}
      onCatalogChanged={loadCatalog}
    />;
  }
  return <OwnerView supabase={supabase} stores={stores} departments={departments} />;
}

// ═══════════════════════════════════════════════════════════════
// COUNT VIEW (used by both owner and employee when a store is active)
// ═══════════════════════════════════════════════════════════════
function CountView({ supabase, profile, isOwner, storeId, stores, departments, brands, flavors, onCategoryAdded, onCatalogChanged }) {
  const store = stores.find(s => s.id === storeId);
  const [count, setCount] = useState(null);
  const [items, setItems] = useState([]);
  const [profileMap, setProfileMap] = useState({}); // id -> { name, role }
  const [activeDeptId, setActiveDeptId] = useState(departments[0]?.id || null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [pastCounts, setPastCounts] = useState([]);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [viewingPast, setViewingPast] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // If the active dept gets removed (or none was set), default to the first.
  useEffect(() => {
    if (!activeDeptId && departments.length > 0) setActiveDeptId(departments[0].id);
  }, [departments, activeDeptId]);

  const todayStr = today();

  const loadTodayCount = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true); setErr('');
    try {
      const { data: existing } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId)
        .eq('count_date', todayStr)
        .maybeSingle();
      setCount(existing || null);

      let itemRows = [];
      if (existing) {
        const res = await supabase
          .from('inventory_count_items')
          .select('*')
          .eq('count_id', existing.id)
          .order('created_at', { ascending: true });
        itemRows = res.data || [];
        setItems(itemRows);
      } else {
        setItems([]);
      }

      // Fetch profiles referenced by this count + items for "added by" labels.
      const ids = new Set();
      if (existing?.created_by) ids.add(existing.created_by);
      if (existing?.submitted_by) ids.add(existing.submitted_by);
      itemRows.forEach(r => { if (r.created_by) ids.add(r.created_by); });
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, name, role')
          .in('id', Array.from(ids));
        const map = {};
        (profs || []).forEach(p => { map[p.id] = p; });
        setProfileMap(map);
      } else {
        setProfileMap({});
      }

      const { data: past } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('store_id', storeId)
        .neq('count_date', todayStr)
        .order('count_date', { ascending: false })
        .limit(10);
      setPastCounts(past || []);
    } catch (e) {
      console.error(e); setErr(e?.message || 'Failed to load count');
    } finally { setLoading(false); }
  }, [supabase, storeId, todayStr]);

  useEffect(() => { loadTodayCount(); }, [loadTodayCount]);

  const ensureCount = async () => {
    if (count) return count;
    const { data, error } = await supabase
      .from('inventory_counts')
      .insert({ store_id: storeId, count_date: todayStr, status: 'draft', created_by: profile?.id })
      .select()
      .single();
    if (error) throw error;
    setCount(data);
    return data;
  };

  const startCount = async () => {
    setBusy(true); setErr('');
    try { await ensureCount(); } catch (e) { setErr(e?.message || 'Failed to start'); }
    setBusy(false);
  };

  // Make sure a brand exists in the catalog for this department; create on the fly.
  // Returns the brand row {id, name} or null if name is empty.
  const ensureBrand = async (departmentId, rawName) => {
    const name = (rawName || '').trim();
    if (!name) return null;
    const existing = brands.find(b =>
      b.department_id === departmentId && b.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;
    const { data, error } = await supabase
      .from('product_brands')
      .insert({ department_id: departmentId, name, created_by: profile?.id || null })
      .select('id, department_id, name')
      .single();
    if (error) throw error;
    if (onCatalogChanged) await onCatalogChanged();
    return data;
  };

  // Same idea for flavors, scoped to a brand.
  const ensureFlavor = async (brandId, rawName) => {
    const name = (rawName || '').trim();
    if (!name || !brandId) return null;
    const existing = flavors.find(f =>
      f.brand_id === brandId && f.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;
    const { data, error } = await supabase
      .from('product_flavors')
      .insert({ brand_id: brandId, name, created_by: profile?.id || null })
      .select('id, brand_id, name')
      .single();
    if (error) throw error;
    if (onCatalogChanged) await onCatalogChanged();
    return data;
  };

  const addCategory = async (rawName) => {
    const name = (rawName || '').trim();
    if (!name) return;
    setBusy(true); setErr('');
    try {
      const dup = departments.find(d => d.name.toLowerCase() === name.toLowerCase());
      if (dup) {
        setActiveDeptId(dup.id);
        setAddingCategory(false);
        setNewCategoryName('');
        return;
      }
      const maxSort = departments.reduce((m, d) => Math.max(m, d.sort_order || 0), 0);
      const { data, error } = await supabase
        .from('inventory_departments')
        .insert({ name, sort_order: maxSort + 10 })
        .select()
        .single();
      if (error) throw error;
      if (onCategoryAdded) await onCategoryAdded();
      setActiveDeptId(data.id);
      setAddingCategory(false);
      setNewCategoryName('');
    } catch (e) { setErr(e?.message || 'Failed to add category'); }
    setBusy(false);
  };

  const addItem = async (dept, form) => {
    setBusy(true); setErr('');
    try {
      const c = await ensureCount();
      const brandRow = await ensureBrand(dept.id, form.brand);
      const flavorRow = brandRow ? await ensureFlavor(brandRow.id, form.flavor) : null;
      const { data, error } = await supabase
        .from('inventory_count_items')
        .insert({
          count_id: c.id,
          department: dept.name,
          department_id: dept.id,
          brand: brandRow?.name || form.brand.trim(),
          flavor: flavorRow?.name || (form.flavor || '').trim(),
          in_stock: num(form.in_stock),
          need_to_order: num(form.need_to_order),
          notes: form.notes?.trim() || null,
          created_by: profile?.id,
          created_by_name: profile?.name || null,
        })
        .select()
        .single();
      if (error) throw error;
      setItems(prev => [...prev, data]);
      if (profile?.id && !profileMap[profile.id]) {
        setProfileMap(m => ({ ...m, [profile.id]: { id: profile.id, name: profile.name, role: profile.role } }));
      }
    } catch (e) { setErr(e?.message || 'Failed to add'); }
    setBusy(false);
  };

  const updateItem = async (id, patch) => {
    setBusy(true); setErr('');
    try {
      const item = items.find(it => it.id === id);
      const deptId = item?.department_id;
      let nextPatch = { ...patch };
      if (deptId && (patch.brand !== undefined || patch.flavor !== undefined)) {
        const brandRow = await ensureBrand(deptId, patch.brand ?? item?.brand);
        const flavorRow = brandRow
          ? await ensureFlavor(brandRow.id, patch.flavor ?? item?.flavor)
          : null;
        if (patch.brand !== undefined) nextPatch.brand = brandRow?.name || (patch.brand || '').trim();
        if (patch.flavor !== undefined) nextPatch.flavor = flavorRow?.name || (patch.flavor || '').trim();
      }
      const { data, error } = await supabase
        .from('inventory_count_items')
        .update(nextPatch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setItems(prev => prev.map(it => it.id === id ? data : it));
    } catch (e) { setErr(e?.message || 'Failed to update'); }
    setBusy(false);
  };

  const deleteItem = async (id) => {
    setBusy(true); setErr('');
    try {
      const { error } = await supabase.from('inventory_count_items').delete().eq('id', id);
      if (error) throw error;
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) { setErr(e?.message || 'Failed to delete'); }
    setBusy(false);
  };

  const submitCount = async () => {
    setConfirmSubmit(false);
    setBusy(true); setErr('');
    try {
      if (!count) throw new Error('No count to submit');
      const { data, error } = await supabase
        .from('inventory_counts')
        .update({ status: 'submitted', submitted_at: new Date().toISOString(), submitted_by: profile?.id })
        .eq('id', count.id)
        .select()
        .single();
      if (error) throw error;
      setCount(data);
      setMsg('Count submitted! Owner has been notified.');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) { setErr(e?.message || 'Failed to submit'); }
    setBusy(false);
  };

  if (!storeId) return <Alert type="warning">No store assigned to your account.</Alert>;
  if (loading) return <Loading />;

  if (viewingPast) {
    return <PastCountView supabase={supabase} count={viewingPast} departments={departments} onBack={() => setViewingPast(null)} />;
  }

  const submitted = count?.status === 'submitted';
  const activeDept = departments.find(d => d.id === activeDeptId);
  const itemsByDept = (deptId) => items.filter(it => it.department_id === deptId);

  const lastItem = items.length > 0 ? items[items.length - 1] : null;
  const lastTs = count?.submitted_at || lastItem?.created_at || count?.created_at;

  return (
    <div>
      <PageHeader
        title="Inventory Count"
        subtitle={<span className="flex items-center gap-2">{store && <StoreBadge name={store.name} color={store.color} />}<span>· {fmtDate(todayStr)}</span></span>}
      >
        <Button variant="secondary" onClick={loadTodayCount} disabled={busy}>↻ Refresh</Button>
      </PageHeader>

      {count && lastTs && (
        <div className="text-[11px] text-[var(--text-secondary)] mb-2">
          Last updated {new Date(lastTs).toLocaleString()}
          {isOwner && <span className="ml-2 italic">(viewing as owner — edits allowed)</span>}
        </div>
      )}

      {err && <Alert type="error">{err}</Alert>}
      {msg && <Alert type="success">{msg}</Alert>}

      {!count && (
        <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-6 text-center mb-4">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-[var(--text-primary)] font-bold mb-1">Ready to count inventory?</div>
          <div className="text-[var(--text-secondary)] text-sm mb-4">Walk through the store, pick a department, and add what you see.</div>
          <Button onClick={startCount} disabled={busy}>{busy ? 'Starting…' : 'Start Count'}</Button>
        </div>
      )}

      {count && (
        <>
          {submitted && (
            <Alert type="success">This count has been submitted and is now read-only.</Alert>
          )}

          {/* Category tabs (+ Add Category) */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
            {departments.map(d => {
              const n = itemsByDept(d.id).length;
              const active = d.id === activeDeptId;
              return (
                <button
                  key={d.id}
                  onClick={() => setActiveDeptId(d.id)}
                  className={`flex-shrink-0 px-4 py-3 rounded-lg text-sm font-semibold whitespace-nowrap border transition-colors min-h-[48px] ${active ? 'bg-sw-blueD text-[var(--color-info)] border-sw-blue' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]'}`}
                >
                  <span className="mr-1">{DEPT_ICONS[d.name] || '📦'}</span>
                  {d.name}
                  {n > 0 && <span className="ml-2 text-[11px] opacity-80">({n})</span>}
                </button>
              );
            })}
            {!submitted && (
              <button
                onClick={() => setAddingCategory(true)}
                className="flex-shrink-0 px-4 py-3 rounded-lg text-sm font-semibold whitespace-nowrap border border-dashed border-sw-blue text-[var(--color-info)] bg-[var(--bg-elevated)] min-h-[48px]"
              >
                + Add Category
              </button>
            )}
          </div>

          {addingCategory && (
            <div className="bg-[var(--bg-card)] border border-sw-blue rounded-lg p-3 mb-4 flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[180px]">
                <Field label="New Category">
                  <input
                    className={inputClass}
                    autoFocus
                    autoCapitalize="words"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory(newCategoryName); }}
                    placeholder="e.g. Drinks"
                  />
                </Field>
              </div>
              <Button onClick={() => addCategory(newCategoryName)} disabled={busy || !newCategoryName.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={() => { setAddingCategory(false); setNewCategoryName(''); }} disabled={busy}>Cancel</Button>
            </div>
          )}

          {activeDept && (
            <DeptPanel
              dept={activeDept}
              items={itemsByDept(activeDept.id)}
              brands={brands.filter(b => b.department_id === activeDept.id)}
              flavors={flavors}
              onAdd={(form) => addItem(activeDept, form)}
              onUpdate={updateItem}
              onDelete={deleteItem}
              busy={busy}
              readonly={submitted}
              profileMap={profileMap}
            />
          )}

          {!submitted && items.length > 0 && (
            <div className="mt-6 sticky bottom-3">
              <Button onClick={() => setConfirmSubmit(true)} disabled={busy} className="w-full text-base py-4">
                Submit Inventory Count ({items.length} items)
              </Button>
            </div>
          )}
        </>
      )}

      {pastCounts.length > 0 && (
        <div className="mt-8">
          <div className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider mb-2">Previous Counts</div>
          <div className="space-y-2">
            {pastCounts.map(pc => (
              <button
                key={pc.id}
                onClick={() => setViewingPast(pc)}
                className="w-full text-left bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-3 flex justify-between items-center hover:border-sw-blue transition-colors"
              >
                <span className="text-[var(--text-primary)] text-sm">{fmtDate(pc.count_date)}</span>
                <span className="text-xs text-[var(--text-secondary)]">
                  {pc.status === 'submitted' ? '✅ Submitted' : pc.status === 'draft' ? '📝 Draft' : pc.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmSubmit && (
        <ConfirmModal
          title="Submit Count?"
          message={`Submit count for ${store?.name || 'this store'}? Owner will be notified and you won't be able to edit afterwards.`}
          confirmLabel="Submit"
          confirmVariant="success"
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={submitCount}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEPARTMENT PANEL (add + list items)
// ═══════════════════════════════════════════════════════════════
function DeptPanel({ dept, items, brands = [], flavors = [], onAdd, onUpdate, onDelete, busy, readonly, profileMap = {} }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const handleAdd = async (form) => {
    await onAdd(form);
    setShowForm(false);
  };

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="text-[var(--text-primary)] font-bold text-sm uppercase tracking-wide">
          {DEPT_ICONS[dept.name] || '📦'} {dept.name}
        </div>
        {!readonly && !showForm && !editingId && (
          <Button onClick={() => setShowForm(true)}>+ Add Item</Button>
        )}
      </div>

      {items.length === 0 && !showForm && (
        <EmptyState icon="📝" title="No items yet" message={readonly ? 'Nothing was counted in this department.' : 'Tap Add Item to start entering products.'} />
      )}

      <div className="space-y-2">
        {items.map((it, idx) => (
          editingId === it.id ? (
            <ItemForm
              key={it.id}
              initial={it}
              brands={brands}
              flavors={flavors}
              onSave={async (form) => { await onUpdate(it.id, form); setEditingId(null); }}
              onCancel={() => setEditingId(null)}
              busy={busy}
            />
          ) : (
            <div
              key={it.id}
              className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg p-3 flex justify-between items-start gap-3"
            >
              <button
                className="flex-1 text-left"
                disabled={readonly}
                onClick={() => !readonly && setEditingId(it.id)}
              >
                <div className="text-[var(--text-primary)] text-sm">
                  <span className="text-[var(--text-secondary)]">{idx + 1}.</span> <span className="font-semibold">{it.brand}</span>
                  {it.flavor && <span className="text-[var(--text-secondary)]"> · {it.flavor}</span>}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Qty: <span className="text-[var(--text-primary)] font-semibold">{it.in_stock}</span>
                  {it.need_to_order > 0 && (
                    <span className="ml-3">→ Need to order: <span className="text-[var(--color-warning)] font-semibold">{it.need_to_order}</span></span>
                  )}
                </div>
                {it.notes && <div className="text-[11px] text-[var(--text-secondary)] mt-1 italic">{it.notes}</div>}
                {it.created_by && profileMap[it.created_by] && (
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                    added by {profileMap[it.created_by].name || 'Unknown'}
                    {profileMap[it.created_by].role && <span className="opacity-70"> ({profileMap[it.created_by].role})</span>}
                  </div>
                )}
              </button>
              {!readonly && (
                <button
                  onClick={() => onDelete(it.id)}
                  className="text-[var(--color-danger)] text-lg px-2 min-h-[40px]"
                  aria-label="Delete"
                >✕</button>
              )}
            </div>
          )
        ))}

        {showForm && (
          <ItemForm
            brands={brands}
            flavors={flavors}
            onSave={handleAdd}
            onCancel={() => setShowForm(false)}
            busy={busy}
          />
        )}
      </div>

      {!readonly && !showForm && !editingId && items.length > 0 && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setShowForm(true)} className="w-full">+ Add Another Item</Button>
        </div>
      )}
    </div>
  );
}

function ItemForm({ initial, brands = [], flavors = [], onSave, onCancel, busy }) {
  const [form, setForm] = useState({
    brand: initial?.brand || '',
    flavor: initial?.flavor || '',
    in_stock: initial?.in_stock ?? '',
    need_to_order: initial?.need_to_order ?? '',
    notes: initial?.notes || '',
  });
  const canSave = form.brand.trim().length > 0;

  // Match the typed brand text to a known brand row so we can scope flavor suggestions.
  const matchedBrand = useMemo(() => {
    const t = form.brand.trim().toLowerCase();
    return t ? brands.find(b => b.name.toLowerCase() === t) : null;
  }, [brands, form.brand]);
  const flavorOptions = useMemo(() => {
    if (!matchedBrand) return [];
    return flavors.filter(f => f.brand_id === matchedBrand.id);
  }, [flavors, matchedBrand]);

  // Datalist IDs need to be unique per form instance (multiple forms can be open at once).
  const uid = useMemo(() => Math.random().toString(36).slice(2, 9), []);
  const brandListId = `brand-list-${uid}`;
  const flavorListId = `flavor-list-${uid}`;

  return (
    <div className="bg-[var(--bg-card)] border border-sw-blue rounded-lg p-3">
      <Field label="Brand">
        <input
          className={inputClass}
          list={brandListId}
          autoCapitalize="words"
          autoFocus
          value={form.brand}
          onChange={e => setForm({ ...form, brand: e.target.value })}
          placeholder="Pick a brand or type to add"
        />
        <datalist id={brandListId}>
          {brands.map(b => <option key={b.id} value={b.name} />)}
        </datalist>
      </Field>
      <Field label="Flavor / Name (optional)">
        <input
          className={inputClass}
          list={flavorListId}
          autoCapitalize="words"
          value={form.flavor}
          onChange={e => setForm({ ...form, flavor: e.target.value })}
          placeholder={matchedBrand ? 'Pick a flavor or type to add' : 'Pick a brand first, then choose a flavor'}
        />
        <datalist id={flavorListId}>
          {flavorOptions.map(f => <option key={f.id} value={f.name} />)}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <input
            className={inputClass}
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.in_stock}
            onChange={e => setForm({ ...form, in_stock: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="0"
          />
        </Field>
        <Field label="Need to Order">
          <input
            className={inputClass}
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.need_to_order}
            onChange={e => setForm({ ...form, need_to_order: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="0"
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input
          className={inputClass}
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder=""
        />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => canSave && onSave(form)} disabled={!canSave || busy} className="flex-1">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAST COUNT VIEWER (employee view of old count)
// ═══════════════════════════════════════════════════════════════
function PastCountView({ supabase, count, departments, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('inventory_count_items').select('*').eq('count_id', count.id).order('created_at');
      setItems(data || []);
      setLoading(false);
    })();
  }, [supabase, count.id]);

  if (loading) return <Loading />;
  const byDept = (id) => items.filter(i => i.department_id === id);

  return (
    <div>
      <PageHeader title={fmtDate(count.count_date)} subtitle={count.status === 'submitted' ? '✅ Submitted' : count.status}>
        <Button variant="secondary" onClick={onBack}>← Back</Button>
      </PageHeader>
      {departments.map(d => {
        const di = byDept(d.id);
        if (di.length === 0) return null;
        return (
          <div key={d.id} className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-4 mb-3">
            <div className="text-[var(--text-primary)] font-bold text-sm mb-2">{DEPT_ICONS[d.name] || '📦'} {d.name}</div>
            {di.map((it, idx) => (
              <div key={it.id} className="text-sm text-[var(--text-primary)] py-1">
                <span className="text-[var(--text-secondary)]">{idx + 1}.</span> {it.brand}
                {it.flavor && <span className="text-[var(--text-secondary)]"> · {it.flavor}</span>}
                <span className="text-[var(--text-secondary)]"> · Qty: {it.in_stock}</span>
                {it.need_to_order > 0 && <span className="text-[var(--color-warning)]"> · Order: {it.need_to_order}</span>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OWNER VIEW
// ═══════════════════════════════════════════════════════════════
function OwnerView({ supabase, stores, departments }) {
  const [latestByStore, setLatestByStore] = useState({}); // storeId -> { count, itemCount }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState(null); // count
  const [showCombined, setShowCombined] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .order('count_date', { ascending: false });

      const map = {};
      for (const c of counts || []) {
        if (!map[c.store_id]) map[c.store_id] = c;
      }

      const ids = Object.values(map).map(c => c.id);
      let counts2 = {};
      if (ids.length > 0) {
        const { data: itemRows } = await supabase
          .from('inventory_count_items')
          .select('count_id')
          .in('count_id', ids);
        (itemRows || []).forEach(r => { counts2[r.count_id] = (counts2[r.count_id] || 0) + 1; });
      }

      const out = {};
      Object.entries(map).forEach(([sid, c]) => {
        out[sid] = { count: c, itemCount: counts2[c.id] || 0 };
      });
      setLatestByStore(out);
    } catch (e) {
      console.error(e); setErr(e?.message || 'Failed to load');
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  if (loading) return <Loading />;

  if (viewing) {
    return <OwnerCountView
      supabase={supabase}
      count={viewing}
      store={stores.find(s => s.id === viewing.store_id)}
      departments={departments}
      onBack={() => { setViewing(null); loadStatus(); }}
    />;
  }

  if (showCombined) {
    return <CombinedOrderView
      supabase={supabase}
      stores={stores}
      departments={departments}
      onBack={() => setShowCombined(false)}
    />;
  }

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Store count status & order sheets">
        <Button onClick={() => setShowCombined(true)}>📋 Combined Order Sheet</Button>
      </PageHeader>

      {err && <Alert type="error">{err}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {stores.map(s => {
          const entry = latestByStore[s.id];
          const c = entry?.count;
          const statusIcon = !c ? '⚠️' : c.status === 'draft' ? '📝' : '✅';
          const statusText = !c ? 'No count yet' : c.status === 'draft' ? 'Draft in progress' : `Submitted ${fmtDate(c.count_date)}`;
          return (
            <div key={s.id} className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ background: s.color || '#39FF14' }} />
                <span className="text-[var(--text-primary)] font-bold">{s.name}</span>
              </div>
              <div className="text-[var(--text-secondary)] text-xs mb-1">{statusIcon} {statusText}</div>
              {entry && <div className="text-[var(--text-secondary)] text-xs mb-3">{entry.itemCount} items counted</div>}
              {c ? (
                <Button variant="secondary" onClick={() => setViewing(c)} className="w-full">View</Button>
              ) : (
                <div className="text-[var(--text-secondary)] text-xs italic">Waiting on employee</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OWNER: single-count viewer (smart order sheet)
// ═══════════════════════════════════════════════════════════════
function OwnerCountView({ supabase, count, store, departments, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('order'); // 'order' | 'full'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('inventory_count_items').select('*').eq('count_id', count.id).order('created_at');
      setItems(data || []);
      setLoading(false);
    })();
  }, [supabase, count.id]);

  const orderItems = items.filter(i => num(i.need_to_order) > 0);

  const grouped = useMemo(() => {
    const src = mode === 'order' ? orderItems : items;
    const g = {};
    for (const d of departments) g[d.id] = { dept: d, rows: [] };
    src.forEach(it => { if (g[it.department_id]) g[it.department_id].rows.push(it); });
    return Object.values(g).filter(x => x.rows.length > 0);
  }, [items, orderItems, departments, mode]);

  const exportCSV = () => {
    const rows = [['Department', 'Brand', 'Flavor', 'Stock', 'Order', 'Notes']];
    grouped.forEach(({ dept, rows: rs }) => {
      rs.forEach(it => rows.push([dept.name, it.brand, it.flavor || '', it.in_stock, it.need_to_order, it.notes || '']));
    });
    const fname = `order-${store?.name || 'store'}-${count.count_date}.csv`;
    downloadCSV(fname, rows[0], rows.slice(1));
  };

  const exportXLSX = () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      [`Order Sheet — ${store?.name || ''}`],
      [`Date: ${count.count_date}   Status: ${count.status}`],
      [],
    ];
    grouped.forEach(({ dept, rows: rs }) => {
      aoa.push([`${dept.name.toUpperCase()} (${rs.length} ${mode === 'order' ? 'to order' : 'items'})`]);
      aoa.push(['Brand', 'Flavor', 'Stock', 'Order', 'Notes']);
      rs.forEach(it => aoa.push([it.brand, it.flavor || '', num(it.in_stock), num(it.need_to_order), it.notes || '']));
      aoa.push([]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Order Sheet');
    XLSX.writeFile(wb, `order-${store?.name || 'store'}-${count.count_date}.xlsx`);
  };

  const markOrdered = async () => {
    setBusy(true);
    try {
      await supabase.from('inventory_counts').update({ status: 'ordered' }).eq('id', count.id);
      onBack();
    } finally { setBusy(false); }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader
        title={`${mode === 'order' ? 'Order Sheet' : 'Full Count'} — ${store?.name || ''}`}
        subtitle={`${fmtDate(count.count_date)} · ${count.status}`}
      >
        <Button variant="secondary" onClick={onBack}>← Back</Button>
      </PageHeader>

      <div className="flex gap-2 mb-4">
        <Button variant={mode === 'order' ? 'primary' : 'secondary'} onClick={() => setMode('order')}>
          Order Sheet ({orderItems.length})
        </Button>
        <Button variant={mode === 'full' ? 'primary' : 'secondary'} onClick={() => setMode('full')}>
          Full Count ({items.length})
        </Button>
      </div>

      {grouped.length === 0 && (
        <EmptyState icon="📭" title={mode === 'order' ? 'Nothing to order' : 'No items'} message={mode === 'order' ? 'All stock levels look good.' : undefined} />
      )}

      {grouped.map(({ dept, rows }) => (
        <div key={dept.id} className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-4 mb-4">
          <div className="text-[var(--text-primary)] font-bold text-sm mb-3">
            {DEPT_ICONS[dept.name] || '📦'} {dept.name.toUpperCase()} ({rows.length} {mode === 'order' ? 'to order' : 'items'})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-secondary)] text-[10px] uppercase tracking-wider text-left border-b border-[var(--border-subtle)]">
                  <th className="py-2 pr-2">Brand</th>
                  <th className="py-2 pr-2">Flavor</th>
                  <th className="py-2 pr-2 text-right">Stock</th>
                  <th className="py-2 pr-2 text-right">Order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(it => (
                  <tr key={it.id} className="border-b border-[var(--border-subtle)]/50">
                    <td className="py-2 pr-2 text-[var(--text-primary)] font-semibold">{it.brand}</td>
                    <td className="py-2 pr-2 text-[var(--text-secondary)]">{it.flavor}</td>
                    <td className="py-2 pr-2 text-right text-[var(--text-primary)]">{it.in_stock}</td>
                    <td className="py-2 pr-2 text-right text-[var(--color-warning)] font-bold">{it.need_to_order || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {grouped.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          <Button onClick={exportXLSX}>⬇ Download Excel</Button>
          <Button variant="secondary" onClick={exportCSV}>⬇ CSV</Button>
          {mode === 'order' && count.status !== 'ordered' && (
            <Button variant="success" onClick={markOrdered} disabled={busy}>Mark as Ordered</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMBINED ORDER SHEET (across all stores)
// ═══════════════════════════════════════════════════════════════
function CombinedOrderView({ supabase, stores, departments, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // latest submitted count per store
      const { data: counts } = await supabase
        .from('inventory_counts')
        .select('*')
        .eq('status', 'submitted')
        .order('count_date', { ascending: false });

      const latest = {};
      for (const c of counts || []) if (!latest[c.store_id]) latest[c.store_id] = c;
      const ids = Object.values(latest).map(c => c.id);

      if (ids.length === 0) { setRows([]); setLoading(false); return; }

      const { data: items } = await supabase
        .from('inventory_count_items')
        .select('*')
        .in('count_id', ids)
        .gt('need_to_order', 0);

      // group by dept|brand|flavor
      const key = (it) => `${it.department_id}||${(it.brand || '').trim().toLowerCase()}||${(it.flavor || '').trim().toLowerCase()}`;
      const map = {};
      const storeById = {};
      Object.entries(latest).forEach(([sid, c]) => { storeById[c.id] = stores.find(s => s.id === sid); });

      (items || []).forEach(it => {
        const k = key(it);
        if (!map[k]) {
          map[k] = {
            department_id: it.department_id,
            brand: it.brand,
            flavor: it.flavor || '',
            byStore: {},
            total: 0,
          };
        }
        const storeName = storeById[it.count_id]?.name || '?';
        map[k].byStore[storeName] = (map[k].byStore[storeName] || 0) + num(it.need_to_order);
        map[k].total += num(it.need_to_order);
      });

      setRows(Object.values(map));
      setLoading(false);
    })();
  }, [supabase, stores]);

  const grouped = useMemo(() => {
    const g = {};
    for (const d of departments) g[d.id] = { dept: d, rows: [] };
    rows.forEach(r => { if (g[r.department_id]) g[r.department_id].rows.push(r); });
    return Object.values(g).filter(x => x.rows.length > 0);
  }, [rows, departments]);

  const exportCSV = () => {
    const header = ['Department', 'Brand', 'Flavor', 'Total', ...stores.map(s => s.name)];
    const out = [];
    grouped.forEach(({ dept, rows: rs }) => {
      rs.forEach(r => {
        out.push([dept.name, r.brand, r.flavor, r.total, ...stores.map(s => r.byStore[s.name] || 0)]);
      });
    });
    downloadCSV(`combined-order-${today()}.csv`, header, out);
  };

  const exportXLSX = () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      ['Combined Order Sheet'],
      [`Generated: ${today()}`],
      [],
    ];
    grouped.forEach(({ dept, rows: rs }) => {
      aoa.push([dept.name.toUpperCase()]);
      aoa.push(['Brand', 'Flavor', ...stores.map(s => s.name), 'TOTAL']);
      rs.forEach(r => {
        aoa.push([
          r.brand,
          r.flavor,
          ...stores.map(s => r.byStore[s.name] || 0),
          r.total,
        ]);
      });
      aoa.push([]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 22 }, ...stores.map(() => ({ wch: 12 })), { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Combined Order');
    XLSX.writeFile(wb, `combined-order-${today()}.xlsx`);
  };

  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Combined Order Sheet" subtitle="All submitted counts totaled across stores">
        <Button variant="secondary" onClick={onBack}>← Back</Button>
      </PageHeader>

      {grouped.length === 0 ? (
        <EmptyState icon="📭" title="No pending orders" message="No stores have items marked to order." />
      ) : (
        <>
          {grouped.map(({ dept, rows: rs }) => (
            <div key={dept.id} className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-4 mb-4">
              <div className="text-[var(--text-primary)] font-bold text-sm mb-3">{DEPT_ICONS[dept.name] || '📦'} {dept.name.toUpperCase()}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-secondary)] text-[10px] uppercase tracking-wider text-left border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-2">Brand</th>
                      <th className="py-2 pr-2">Flavor</th>
                      {stores.map(s => <th key={s.id} className="py-2 pr-2 text-right">{s.name}</th>)}
                      <th className="py-2 pr-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rs.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border-subtle)]/50">
                        <td className="py-2 pr-2 text-[var(--text-primary)] font-semibold">{r.brand}</td>
                        <td className="py-2 pr-2 text-[var(--text-secondary)]">{r.flavor}</td>
                        {stores.map(s => (
                          <td key={s.id} className="py-2 pr-2 text-right text-[var(--text-primary)]">{r.byStore[s.name] || '—'}</td>
                        ))}
                        <td className="py-2 pr-2 text-right text-[var(--color-info)] font-bold">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={exportXLSX}>⬇ Download Combined Excel</Button>
            <Button variant="secondary" onClick={exportCSV}>⬇ CSV</Button>
          </div>
        </>
      )}
    </div>
  );
}
