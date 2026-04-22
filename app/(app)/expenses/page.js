'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, Loading, ConfirmModal, Alert, DateBar, useDateRange, StoreBadge, MultiSelect, SmartDatePicker, SortDropdown } from '@/components/UI';
import { fmt, monthLabel, dayLabel, downloadCSV, today, EXPENSE_CATEGORIES, FIXED_EXPENSE_IDS } from '@/lib/utils';
import { logActivity, fmtMoney } from '@/lib/activity';
import { compressImage, uploadReceipt } from '@/lib/storage';
import ImageGallery from '@/components/ImageGallery';

// Convert a public receipts URL back to its storage path so we can delete it.
const pathFromReceiptUrl = (url) => {
  if (!url) return null;
  const m = String(url).match(/\/receipts\/(.+?)(?:\?.*)?$/);
  return m ? decodeURIComponent(m[1]) : null;
};

const now0 = new Date();
const curMonth = `${now0.getFullYear()}-${String(now0.getMonth()+1).padStart(2,'0')}`;
const prevMonthOf = (m) => {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
};

let localIdCounter = 1;
const newLocalId = () => `tmp_${localIdCounter++}`;

export default function ExpensesPage() {
  const { supabase, isOwner, profile, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Page-level filters
  const [pageStoreIds, setPageStoreIds] = useState(effectiveStoreId ? [effectiveStoreId] : []);
  const pageStoreId = pageStoreIds.length === 1 ? pageStoreIds[0] : '';
  const [typeFilter, setTypeFilter] = useState([]); // array of category ids / '__custom__'
  const [search, setSearch] = useState('');
  const [sortState, setSortState] = useState({ key: 'month', dir: 'desc' });
  const expenseSortOptions = [
    { label: 'Date (newest)', key: 'month', dir: 'desc' },
    { label: 'Date (oldest)', key: 'month', dir: 'asc' },
    { label: 'Store A-Z', key: 'store_id', dir: 'asc' },
    { label: 'Type A-Z', key: 'category', dir: 'asc' },
    { label: 'Amount (high-low)', key: 'amount', dir: 'desc' },
    { label: 'Amount (low-high)', key: 'amount', dir: 'asc' },
  ];

  // Single-expense form
  const [form, setForm] = useState({ store_id: '', date: today(), category: 'power', customCategory: '', amount: '', note: '' });
  const [errors, setErrors] = useState({});

  // Receipt images
  const [pendingReceipts, setPendingReceipts] = useState([]); // [{ id, file, preview }]
  const [existingReceipts, setExistingReceipts] = useState([]); // [url]
  const [removedReceipts, setRemovedReceipts] = useState([]); // [url] removed during this edit
  const [galleryImages, setGalleryImages] = useState(null);
  const receiptCameraRef = useRef(null);
  const receiptLibraryRef = useRef(null);

  useEffect(() => {
    if (effectiveStoreId) setPageStoreIds([effectiveStoreId]);
  }, [effectiveStoreId]);

  // Monthly template state
  const [tplOpen, setTplOpen] = useState(false);
  const [tplMonth, setTplMonth] = useState(curMonth);
  const [tplDate, setTplDate] = useState(today());
  const [tplStoreId, setTplStoreId] = useState('');
  const [tplData, setTplData] = useState({});
  const [tplCustom, setTplCustom] = useState({});
  const [tplDeleted, setTplDeleted] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);

      const startMonth = range.start.slice(0, 7);
      const endMonth = range.end.slice(0, 7);
      let q = supabase
        .from('expenses')
        .select('*, stores(name, color)')
        .gte('month', startMonth)
        .lte('month', endMonth)
        .order('month', { ascending: false });
      if (pageStoreIds.length) q = q.in('store_id', pageStoreIds);
      const { data: e } = await q;
      setItems(e || []);
    } catch (err) {
      console.error('[expenses] load failed:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pageStoreIds.join(','), range.start, range.end]);

  const catLabel = id => EXPENSE_CATEGORIES.find(c => c.id === id);
  const renderCatInTable = (v) => {
    const c = catLabel(v);
    return c ? `${c.icon} ${c.label}` : `✨ ${v}`;
  };

  // ── Single-expense form validation ──────────────────────────
  const validate = (f) => {
    const e = {};
    if (!f.store_id) e.store_id = 'Store is required';
    if (!f.date) e.date = 'Date is required';
    if (!f.category) e.category = 'Category is required';
    if (f.category === '__other__' && !(f.customCategory || '').trim()) e.customCategory = 'Enter a name for the expense';
    const amt = parseFloat(f.amount);
    if (f.amount === '' || isNaN(amt)) e.amount = 'Amount is required';
    else if (amt <= 0) e.amount = 'Amount must be greater than 0';
    return e;
  };

  const handleReceiptPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const additions = await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve({ id: `pend_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, file, preview: ev.target.result });
      reader.readAsDataURL(file);
    })));
    setPendingReceipts(prev => [...prev, ...additions]);
    e.target.value = '';
  };
  const removePendingReceipt = (id) => setPendingReceipts(prev => prev.filter(p => p.id !== id));
  const removeExistingReceipt = (url) => {
    setExistingReceipts(prev => prev.filter(u => u !== url));
    setRemovedReceipts(prev => [...prev, url]);
  };

  const handleSave = async () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setMsg('');
    try {
      const amount = parseFloat(form.amount);
      const category = form.category === '__other__' ? form.customCategory.trim() : form.category;
      const monthKey = (form.date || '').slice(0, 7);
      const storeName = stores.find(s => s.id === form.store_id)?.name;

      // Upload any newly attached receipt images first.
      const newUrls = [];
      for (const p of pendingReceipts) {
        try {
          const compressed = await compressImage(p.file);
          const { url } = await uploadReceipt(supabase, compressed, {
            storeName,
            date: form.date,
            kind: 'expense',
          });
          if (url) newUrls.push(url);
        } catch (upErr) {
          console.error('[expenses] receipt upload failed:', upErr);
        }
      }

      // Delete any receipts the user removed during this edit.
      const removedPaths = removedReceipts.map(pathFromReceiptUrl).filter(Boolean);
      if (removedPaths.length) {
        const { error: rmErr } = await supabase.storage.from('receipts').remove(removedPaths);
        if (rmErr) console.warn('[expenses] receipt cleanup failed (non-fatal):', rmErr);
      }

      const image_urls = [...existingReceipts, ...newUrls];

      const payload = {
        store_id: form.store_id,
        month: monthKey,
        expense_date: form.date || null,
        category,
        amount,
        note: (form.note || '').trim(),
        image_urls,
      };

      let inserted, error;
      if (editItem) {
        const res = await supabase.from('expenses').update(payload).eq('id', editItem.id).select().single();
        inserted = res.data; error = res.error;
      } else {
        const res = await supabase.from('expenses').insert(payload).select().single();
        inserted = res.data; error = res.error;
      }
      if (error) { setMsg(error.message); return; }
      await logActivity(supabase, profile, {
        action: editItem ? 'update' : 'create',
        entityType: 'expense',
        entityId: inserted?.id,
        description: `${profile?.name} ${editItem ? 'updated' : 'added'} expense ${catLabel(category)?.label || category} of ${fmtMoney(amount)} for ${storeName} (${form.date})`,
        storeName,
        metadata: editItem ? { before: editItem, after: payload } : null,
      });
      setModal(false);
      setEditItem(null);
      setForm({ store_id: pageStoreId || '', date: today(), category: 'power', customCategory: '', amount: '', note: '' });
      setPendingReceipts([]);
      setExistingReceipts([]);
      setRemovedReceipts([]);
      setErrors({});
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    const row = confirmDelete;
    if (!row) return;
    const { error } = await supabase.from('expenses').delete().eq('id', row.id);
    if (error) { alert(error.message); setConfirmDelete(null); return; }
    await logActivity(supabase, profile, {
      action: 'delete',
      entityType: 'expense',
      entityId: row.id,
      description: `${profile?.name} deleted expense ${catLabel(row.category)?.label || row.category} of ${fmtMoney(row.amount)} for ${row.stores?.name} (${row.month})`,
      storeName: row.stores?.name,
      metadata: { deleted: row },
    });
    setConfirmDelete(null);
    load();
  };

  // ── Monthly template ────────────────────────────────────────
  const prefillTemplate = async (month) => {
    setTplLoading(true);
    try {
      const prevKey = prevMonthOf(month);
      const { data } = await supabase
        .from('expenses')
        .select('id, store_id, category, amount, month')
        .in('month', [month, prevKey]);

      const fixedByKeyCur = {};
      const fixedByKeyPrev = {};
      const customCurByStore = {};
      const customPrevByStore = {};

      (data || []).forEach(r => {
        const isCustom = !FIXED_EXPENSE_IDS.has(r.category);
        if (r.month === month) {
          if (isCustom) {
            if (!customCurByStore[r.store_id]) customCurByStore[r.store_id] = [];
            customCurByStore[r.store_id].push({ id: newLocalId(), origId: r.id, name: r.category, amount: String(r.amount) });
          } else {
            fixedByKeyCur[`${r.store_id}:${r.category}`] = r.amount;
          }
        } else {
          if (isCustom) {
            if (!customPrevByStore[r.store_id]) customPrevByStore[r.store_id] = [];
            customPrevByStore[r.store_id].push({ name: r.category, amount: String(r.amount) });
          } else {
            fixedByKeyPrev[`${r.store_id}:${r.category}`] = r.amount;
          }
        }
      });

      const seededFixed = {};
      for (const st of stores) {
        for (const cat of EXPENSE_CATEGORIES) {
          const key = `${st.id}:${cat.id}`;
          const v = fixedByKeyCur[key] ?? fixedByKeyPrev[key] ?? '';
          seededFixed[key] = v === '' ? '' : String(v);
        }
      }

      const seededCustom = {};
      for (const st of stores) {
        if (customCurByStore[st.id]?.length) {
          seededCustom[st.id] = customCurByStore[st.id];
        } else if (customPrevByStore[st.id]?.length) {
          seededCustom[st.id] = customPrevByStore[st.id].map(r => ({
            id: newLocalId(), name: r.name, amount: r.amount,
          }));
        } else {
          seededCustom[st.id] = [];
        }
      }

      setTplData(seededFixed);
      setTplCustom(seededCustom);
      setTplDeleted([]);
    } catch (e) {
      console.error('[expenses] template prefill failed:', e);
    } finally {
      setTplLoading(false);
    }
  };

  const openTemplate = () => {
    setTplOpen(true);
    const d = today();
    setTplDate(d);
    const m = d.slice(0, 7);
    setTplMonth(m);
    setTplStoreId(pageStoreId || '');
    prefillTemplate(m);
  };

  useEffect(() => {
    if (!tplOpen) return;
    prefillTemplate(tplMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplMonth]);

  const addCustomRow = (storeId) => {
    setTplCustom(prev => ({
      ...prev,
      [storeId]: [...(prev[storeId] || []), { id: newLocalId(), name: '', amount: '' }],
    }));
  };
  const updateCustomRow = (storeId, rowId, patch) => {
    setTplCustom(prev => ({
      ...prev,
      [storeId]: (prev[storeId] || []).map(r => r.id === rowId ? { ...r, ...patch } : r),
    }));
  };
  const removeCustomRow = (storeId, rowId) => {
    setTplCustom(prev => {
      const row = (prev[storeId] || []).find(r => r.id === rowId);
      if (row?.origId) setTplDeleted(d => [...d, row.origId]);
      return {
        ...prev,
        [storeId]: (prev[storeId] || []).filter(r => r.id !== rowId),
      };
    });
  };

  const saveTemplate = async () => {
    setTplSaving(true);
    try {
      const { data: existing } = await supabase
        .from('expenses')
        .select('id, store_id, category, amount')
        .eq('month', tplMonth);
      const existingByKey = {};
      (existing || []).forEach(r => { existingByKey[`${r.store_id}:${r.category}`] = r; });

      const inserts = [];
      const updates = [];

      const templateStoresNow = tplStoreId ? stores.filter(s => s.id === tplStoreId) : stores;

      for (const st of templateStoresNow) {
        for (const cat of EXPENSE_CATEGORIES) {
          const key = `${st.id}:${cat.id}`;
          const raw = tplData[key];
          if (raw === '' || raw == null) continue;
          const amt = parseFloat(raw);
          if (isNaN(amt) || amt <= 0) continue;
          const existingRow = existingByKey[key];
          if (existingRow) {
            if (Number(existingRow.amount) !== amt) updates.push({ id: existingRow.id, amount: amt });
          } else {
            inserts.push({ store_id: st.id, month: tplMonth, category: cat.id, amount: amt });
          }
        }
      }

      for (const st of templateStoresNow) {
        const rows = tplCustom[st.id] || [];
        for (const r of rows) {
          const name = (r.name || '').trim();
          const amt = parseFloat(r.amount);
          if (!name || isNaN(amt) || amt <= 0) continue;
          if (r.origId) {
            const dbRow = (existing || []).find(e => e.id === r.origId);
            if (dbRow) {
              const nameChanged = dbRow.category !== name;
              const amtChanged = Number(dbRow.amount) !== amt;
              if (nameChanged || amtChanged) {
                const { error } = await supabase.from('expenses').update({ category: name, amount: amt }).eq('id', r.origId);
                if (error) throw error;
              }
            }
          } else {
            inserts.push({ store_id: st.id, month: tplMonth, category: name, amount: amt });
          }
        }
      }

      for (const id of tplDeleted) {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) throw error;
      }
      if (inserts.length) {
        const { error } = await supabase.from('expenses').insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase.from('expenses').update({ amount: u.amount }).eq('id', u.id);
        if (error) throw error;
      }

      await logActivity(supabase, profile, {
        action: 'create',
        entityType: 'expense',
        description: `${profile?.name} saved monthly expense template for ${tplMonth} — ${inserts.length} new, ${updates.length} updated, ${tplDeleted.length} removed`,
        metadata: { month: tplMonth, inserts: inserts.length, updates: updates.length, deleted: tplDeleted.length },
      });

      setTplOpen(false);
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } catch (e) {
      console.error('[expenses] template save failed:', e);
      alert(e?.message || 'Template save failed');
    } finally {
      setTplSaving(false);
    }
  };

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const selectedStoreName = stores.find(s => s.id === pageStoreId)?.name;

  const tryOpenAdd = () => {
    setEditItem(null);
    setForm({ store_id: pageStoreId || '', date: today(), category: 'power', customCategory: '', amount: '', note: '' });
    setPendingReceipts([]);
    setExistingReceipts([]);
    setRemovedReceipts([]);
    setErrors({});
    setModal(true);
  };
  const openEdit = (row) => {
    setEditItem(row);
    const isFixed = FIXED_EXPENSE_IDS.has(row.category);
    setForm({
      store_id: row.store_id,
      date: row.expense_date || `${row.month}-01`,
      category: isFixed ? row.category : '__other__',
      customCategory: isFixed ? '' : row.category,
      amount: String(row.amount ?? ''),
      note: row.note || '',
    });
    setPendingReceipts([]);
    setExistingReceipts(Array.isArray(row.image_urls) ? row.image_urls : []);
    setRemovedReceipts([]);
    setErrors({});
    setModal(true);
  };

  // ── Client-side filtering ───────────────────────────────────
  const visibleItems = items.filter(r => {
    if (typeFilter.length) {
      const catMatches = typeFilter.includes(r.category);
      const customMatches = typeFilter.includes('__custom__') && !FIXED_EXPENSE_IDS.has(r.category);
      if (!catMatches && !customMatches) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const catName = (catLabel(r.category)?.label || r.category || '').toLowerCase();
      const haystack = [
        catName,
        (r.stores?.name || '').toLowerCase(),
        String(r.amount ?? ''),
        (r.note || '').toLowerCase(),
        r.month || '',
      ].join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const visibleTotal = visibleItems.reduce((s, r) => s + Number(r.amount || 0), 0);

  // Template modal: use tplStoreId to decide which stores to show
  const templateStoresVisible = tplStoreId ? stores.filter(s => s.id === tplStoreId) : stores;
  const storeTotal = (st) => {
    let sum = 0;
    for (const cat of EXPENSE_CATEGORIES) {
      const v = parseFloat(tplData[`${st.id}:${cat.id}`]);
      if (!isNaN(v)) sum += v;
    }
    for (const r of tplCustom[st.id] || []) {
      const v = parseFloat(r.amount);
      if (!isNaN(v) && (r.name || '').trim()) sum += v;
    }
    return sum;
  };
  const grandTotal = templateStoresVisible.reduce((s, st) => s + storeTotal(st), 0);

  return (
    <div>
      <PageHeader title="📋 Expenses" subtitle={pageStoreId ? selectedStoreName : 'All Stores'}>
        <Button variant="secondary" onClick={() => downloadCSV('expenses.csv', ['Month','Store','Category','Amount','Note'], visibleItems.map(e => [e.month, e.stores?.name, catLabel(e.category)?.label || e.category, e.amount, e.note]))} className="!text-[11px]">📥 CSV</Button>
        <Button variant="secondary" onClick={() => openTemplate()}>📝 Fill Monthly</Button>
        <Button onClick={tryOpenAdd}>+ Add</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

      {/* Page-level store selector */}
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

      {/* Type + search filter row */}
      <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
        <MultiSelect
          label="Type"
          placeholder="All Types"
          unitLabel="type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            ...EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: c.label, icon: c.icon })),
            { value: '__custom__', label: 'Custom/Other', icon: '✨' },
          ]}
        />
        <SortDropdown options={expenseSortOptions} value={sortState} onChange={setSortState} />
        <input
          type="text"
          placeholder="Search expenses… (type, store, amount, notes)"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="!w-full sm:!flex-1 sm:!min-w-[260px] !py-1.5 !text-[11px]"
        />
        {(typeFilter.length || search) && (
          <button onClick={() => { setTypeFilter([]); setSearch(''); }} className="text-[var(--text-muted)] text-[10px] underline">clear</button>
        )}
      </div>

      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <DataTable
          emptyMessage="No expenses for this period. Use Fill Monthly to enter your bills quickly."
          sortState={sortState}
          onSortChange={setSortState}
          columns={[
            { key: 'month', label: 'Date', render: (v, r) => {
              if (r.expense_date) return dayLabel(r.expense_date);
              if (r.created_at) { try { return new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch {} }
              return monthLabel(v);
            }, sortValue: r => r.expense_date || r.created_at?.slice(0, 10) || r.month },
            { key: 'store_id', label: 'Store', render: (_,r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} />, sortValue: r => r.stores?.name || '' },
            { key: 'category', label: 'Type', render: renderCatInTable, sortValue: r => catLabel(r.category)?.label || r.category },
            { key: 'amount', label: 'Amount', align: 'right', mono: true, render: v => <span className="text-[var(--color-danger)]">{fmt(v)}</span>, sortValue: r => Number(r.amount || 0) },
            { key: '_images', label: 'Image', align: 'center', sortable: false, render: (_, r) => {
              const urls = Array.isArray(r.image_urls) ? r.image_urls : [];
              if (!urls.length) return <span className="text-[var(--text-muted)]">—</span>;
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); setGalleryImages(urls.map((u, i) => ({ image_url: u, caption: `${r.stores?.name || ''} · ${r.month}`, downloadName: `receipt-${r.month}-${i+1}.jpg` }))); }}
                  title={urls.length > 1 ? `View receipts (${urls.length})` : 'View receipt'}
                  className="relative inline-flex items-center justify-center w-10 h-10 rounded-md bg-sw-blueD text-[var(--color-info)] border border-sw-blue/30 text-base"
                >
                  📷
                  {urls.length > 1 && <span className="absolute -top-1 -right-1 bg-sw-blue text-black text-[9px] rounded-full px-1 font-bold">{urls.length}</span>}
                </button>
              );
            } },
            { key: 'note', label: 'Note', render: v => v || '—' },
          ]}
          rows={visibleItems}
          isOwner={isOwner}
          onEdit={isOwner ? openEdit : undefined}
          onDelete={isOwner ? id => { const r = visibleItems.find(i => i.id === id); if (r) setConfirmDelete(r); } : undefined}
        />
        {visibleItems.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex justify-between items-center flex-wrap gap-2">
            <span className="text-[var(--text-secondary)] text-[11px] font-bold uppercase tracking-wide">
              Showing {visibleItems.length} of {items.length} expenses
            </span>
            <span className="text-[var(--color-danger)] text-[16px] font-extrabold font-mono">
              TOTAL: {fmt(visibleTotal)}
            </span>
          </div>
        )}
      </div>

      {/* Single-expense form */}
      {modal && (
        <Modal title={editItem ? 'Edit Expense' : 'Add Expense'} onClose={() => { setModal(false); setEditItem(null); setErrors({}); }}>
          <Field label="Store">
            <select
              value={form.store_id}
              onChange={e => setForm({...form, store_id: e.target.value})}
              className={errors.store_id ? '!border-sw-red' : ''}
            >
              <option value="">Select store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.store_id && <p className="text-[var(--color-danger)] text-[11px] mt-1">{errors.store_id}</p>}
          </Field>
          <Field label="Date">
            <SmartDatePicker value={form.date} onChange={v => setForm({...form, date: v})} />
            {errors.date && <p className="text-[var(--color-danger)] text-[11px] mt-1">{errors.date}</p>}
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={errors.category ? '!border-sw-red' : ''}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              <option value="__other__">✨ Other (custom)</option>
            </select>
            {form.category === '__other__' && (
              <input
                type="text"
                className={`mt-2 ${errors.customCategory ? '!border-sw-red' : ''}`}
                placeholder="What is this expense? (e.g. Camera repair)"
                value={form.customCategory}
                onChange={e => setForm({...form, customCategory: e.target.value})}
              />
            )}
            {errors.customCategory && <p className="text-[var(--color-danger)] text-[11px] mt-1">{errors.customCategory}</p>}
          </Field>
          <Field label="Amount">
            <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
              onChange={e => setForm({...form, amount: e.target.value.replace(/^-/, '')})}
              className={errors.amount ? '!border-sw-red' : ''} />
            {errors.amount && <p className="text-[var(--color-danger)] text-[11px] mt-1">{errors.amount}</p>}
          </Field>
          <Field label="Note"><input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="Optional" /></Field>

          <Field label={`Receipt/Bill Image (Optional) — ${existingReceipts.length + pendingReceipts.length} attached`}>
            <div className="flex gap-2 flex-col sm:flex-row mb-2">
              <button
                type="button"
                onClick={() => receiptCameraRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-[var(--color-info)] text-[13px] font-semibold min-h-[44px]"
              >
                <span className="text-lg">📷</span><span>Take Photo</span>
              </button>
              <button
                type="button"
                onClick={() => receiptLibraryRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-[var(--color-info)] text-[13px] font-semibold min-h-[44px]"
              >
                <span className="text-lg">📁</span><span>From Library</span>
              </button>
              <input ref={receiptCameraRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptPick} className="hidden" />
              <input ref={receiptLibraryRef} type="file" accept="image/*" multiple onChange={handleReceiptPick} className="hidden" />
            </div>
            {(existingReceipts.length + pendingReceipts.length) > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {existingReceipts.map((url, i) => (
                  <div key={`ex-${i}`} className="relative">
                    <button
                      type="button"
                      onClick={() => setGalleryImages([...existingReceipts, ...pendingReceipts.map(p => p.preview)].map(u => ({ image_url: u })))}
                      className="block w-full aspect-square rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-black/20"
                    >
                      <img src={url} alt="Receipt" className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExistingReceipt(url)}
                      title="Remove"
                      className="absolute top-1 right-1 w-7 h-7 rounded-md bg-sw-redD border border-sw-red/50 text-[var(--color-danger)] text-sm flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {pendingReceipts.map(p => (
                  <div key={p.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setGalleryImages([{ image_url: p.preview }])}
                      className="block w-full aspect-square rounded-lg overflow-hidden border border-sw-blue/40 bg-black/20"
                    >
                      <img src={p.preview} alt="New receipt" className="w-full h-full object-cover" />
                    </button>
                    <span className="absolute top-1 left-1 bg-sw-blueD text-[var(--color-info)] border border-sw-blue/40 text-[9px] font-bold px-1 rounded">NEW</span>
                    <button
                      type="button"
                      onClick={() => removePendingReceipt(p.id)}
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

          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setModal(false); setEditItem(null); setErrors({}); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : (editItem ? 'Update' : 'Save')}
            </Button>
          </div>
        </Modal>
      )}

      {/* Monthly template modal */}
      {tplOpen && (
        <Modal title="Fill Monthly Expenses" onClose={() => setTplOpen(false)} wide>
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <label className="text-[var(--text-secondary)] text-[11px] font-bold uppercase">Store</label>
            <select
              value={tplStoreId}
              onChange={e => setTplStoreId(e.target.value)}
              className="!w-auto md:!w-[200px] !py-1.5 !text-[11px]"
            >
              <option value="">All Stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="text-[var(--text-secondary)] text-[11px] font-bold uppercase">Date</label>
            <SmartDatePicker value={tplDate} onChange={v => { setTplDate(v); if (v) setTplMonth(v.slice(0, 7)); }} />
            <span className="text-[var(--text-muted)] text-[11px]">Blank rows are skipped.</span>
          </div>

          {tplLoading ? (
            <div className="py-8 text-center text-[var(--text-muted)]">Loading template…</div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-auto pr-1">
              {templateStoresVisible.map(st => {
                const total = storeTotal(st);
                return (
                  <div key={st.id} className="bg-[var(--bg-card)] rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: st.color }} />
                        <span className="text-[var(--text-primary)] text-[13px] font-bold">{st.name}</span>
                      </div>
                      <span className="text-[var(--color-success)] text-[12px] font-mono font-bold">{fmt(total)}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                      {EXPENSE_CATEGORIES.map(cat => {
                        const key = `${st.id}:${cat.id}`;
                        return (
                          <div key={key}>
                            <label className="block text-[var(--text-secondary)] text-[10px] font-semibold mb-0.5">
                              {cat.icon} {cat.label}
                            </label>
                            <input
                              type="number" min="0" step="0.01" placeholder="0.00"
                              value={tplData[key] ?? ''}
                              onChange={e => setTplData(d => ({ ...d, [key]: e.target.value.replace(/^-/, '') }))}
                              className="!py-1.5"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-[var(--border-subtle)] pt-2">
                      <div className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wide mb-1.5">Custom Expenses</div>
                      {(tplCustom[st.id] || []).length === 0 && (
                        <p className="text-[var(--text-muted)] text-[11px] italic mb-1.5">No custom expenses — add below for items like camera repair, pest control, signage, etc.</p>
                      )}
                      <div className="space-y-1.5 mb-2">
                        {(tplCustom[st.id] || []).map(row => (
                          <div key={row.id} className="flex gap-1.5 items-center">
                            <input
                              type="text"
                              placeholder="Expense name (e.g. Pest control)"
                              value={row.name}
                              onChange={e => updateCustomRow(st.id, row.id, { name: e.target.value })}
                              className="!py-1.5 flex-1"
                            />
                            <input
                              type="number" min="0" step="0.01" placeholder="0.00"
                              value={row.amount}
                              onChange={e => updateCustomRow(st.id, row.id, { amount: e.target.value.replace(/^-/, '') })}
                              className="!py-1.5 !w-[110px] flex-shrink-0"
                            />
                            <button
                              type="button"
                              onClick={() => removeCustomRow(st.id, row.id)}
                              className="w-8 h-8 rounded-md bg-sw-redD text-[var(--color-danger)] border border-sw-red/30 flex items-center justify-center flex-shrink-0"
                              title="Remove"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addCustomRow(st.id)}
                        className="text-[var(--color-info)] text-[11px] font-semibold border border-sw-blue/30 rounded px-2 py-1 bg-sw-blueD hover:bg-sw-blue/20"
                      >
                        + Add Custom Expense
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-between items-center mt-4 sticky bottom-0 bg-[var(--bg-elevated)] pt-2 border-t border-[var(--border-subtle)]">
            <div className="text-[11px] text-[var(--text-secondary)]">
              Grand total: <span className="text-[var(--color-success)] font-mono font-bold text-[13px]">{fmt(grandTotal)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setTplOpen(false)}>Cancel</Button>
              <Button onClick={saveTemplate} disabled={tplSaving || tplLoading}>
                {tplSaving ? 'Saving…' : 'Save All Expenses'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ImageGallery
        images={galleryImages || []}
        isOpen={!!galleryImages}
        onClose={() => setGalleryImages(null)}
      />

      {confirmDelete && (
        <ConfirmModal
          title="Delete this expense?"
          message={`Are you sure? This will be logged in the activity trail. Deleting ${catLabel(confirmDelete.category)?.label || confirmDelete.category} expense of ${fmtMoney(confirmDelete.amount)} for ${confirmDelete.stores?.name || 'store'}.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
