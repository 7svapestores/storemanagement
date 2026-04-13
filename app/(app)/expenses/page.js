'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, Loading, ConfirmModal, Alert, StoreRequiredModal } from '@/components/UI';
import { fmt, monthLabel, downloadCSV, EXPENSE_CATEGORIES, FIXED_EXPENSE_IDS } from '@/lib/utils';
import { logActivity, fmtMoney } from '@/lib/activity';

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
  const { supabase, isOwner, profile, effectiveStoreId, setSelectedStore } = useAuth();
  const [showStorePicker, setShowStorePicker] = useState(null); // 'add' | 'template' | null
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ store_id: '', month: curMonth, category: 'power', amount: '', note: '' });
  const [errors, setErrors] = useState({});

  // Monthly template state
  const [tplOpen, setTplOpen] = useState(false);
  const [tplMonth, setTplMonth] = useState(curMonth);
  const [tplData, setTplData] = useState({});     // { `${storeId}:${fixedCategoryId}`: amount-string }
  const [tplCustom, setTplCustom] = useState({}); // { storeId: [{ id, origId?, name, amount }] }
  const [tplDeleted, setTplDeleted] = useState([]); // DB ids of custom rows to delete on save
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);

      let q = supabase.from('expenses').select('*, stores(name, color)').order('month', { ascending: false });
      if (effectiveStoreId) q = q.eq('store_id', effectiveStoreId);
      const { data: e } = await q;
      setItems(e || []);

      if (!form.store_id && st?.length) setForm(f => ({ ...f, store_id: effectiveStoreId || st[0].id }));
    } catch (err) {
      console.error('[expenses] load failed:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [effectiveStoreId]);

  const catLabel = id => EXPENSE_CATEGORIES.find(c => c.id === id);
  // For custom rows loaded from DB, show the raw name (the id) as the label.
  const renderCatInTable = (v) => {
    const c = catLabel(v);
    return c ? `${c.icon} ${c.label}` : `✨ ${v}`;
  };

  // ── Single-expense form validation ──────────────────────────
  const validate = (f) => {
    const e = {};
    if (!f.month) e.month = 'Month is required';
    if (!f.category) e.category = 'Category is required';
    const amt = parseFloat(f.amount);
    if (f.amount === '' || isNaN(amt)) e.amount = 'Amount is required';
    else if (amt <= 0) e.amount = 'Amount must be greater than 0';
    return e;
  };

  const handleSave = async () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setMsg('');
    try {
      const amount = parseFloat(form.amount);
      const payload = {
        store_id: form.store_id,
        month: form.month,
        category: form.category,
        amount,
        note: (form.note || '').trim(),
      };
      const { data: inserted, error } = await supabase.from('expenses').insert(payload).select().single();
      if (error) { setMsg(error.message); return; }
      const storeName = stores.find(s => s.id === form.store_id)?.name;
      await logActivity(supabase, profile, {
        action: 'create',
        entityType: 'expense',
        entityId: inserted?.id,
        description: `${profile?.name} added expense ${catLabel(form.category)?.label || form.category} of ${fmtMoney(amount)} for ${storeName} (${form.month})`,
        storeName,
      });
      setModal(false);
      setForm({ store_id: stores[0]?.id || '', month: curMonth, category: 'power', amount: '', note: '' });
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
      description: `${profile?.name} deleted expense ${catLabel(row.category)?.label || row.category || row.category} of ${fmtMoney(row.amount)} for ${row.stores?.name} (${row.month})`,
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

      // Split current + previous, fixed + custom.
      const fixedByKeyCur = {};
      const fixedByKeyPrev = {};
      const customCurByStore = {}; // { storeId: [{ id, origId, name, amount }] }
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

      // Seed fixed categories — current month, fall back to previous.
      const seededFixed = {};
      for (const st of stores) {
        for (const cat of EXPENSE_CATEGORIES) {
          const key = `${st.id}:${cat.id}`;
          const v = fixedByKeyCur[key] ?? fixedByKeyPrev[key] ?? '';
          seededFixed[key] = v === '' ? '' : String(v);
        }
      }

      // Seed custom rows — use current month rows if present (with origIds for update/delete),
      // otherwise clone previous month rows as brand-new inserts.
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
    setTplMonth(curMonth);
    prefillTemplate(curMonth);
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
      if (row?.origId) {
        setTplDeleted(d => [...d, row.origId]);
      }
      return {
        ...prev,
        [storeId]: (prev[storeId] || []).filter(r => r.id !== rowId),
      };
    });
  };

  const saveTemplate = async () => {
    setTplSaving(true);
    try {
      // Fetch existing rows for the month so we know what's insert vs update.
      const { data: existing } = await supabase
        .from('expenses')
        .select('id, store_id, category, amount')
        .eq('month', tplMonth);
      const existingByKey = {};
      (existing || []).forEach(r => {
        existingByKey[`${r.store_id}:${r.category}`] = r;
      });

      const inserts = [];
      const updates = [];

      // Fixed categories
      for (const st of stores) {
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

      // Custom rows per store
      for (const st of stores) {
        const rows = tplCustom[st.id] || [];
        for (const r of rows) {
          const name = (r.name || '').trim();
          const amt = parseFloat(r.amount);
          if (!name || isNaN(amt) || amt <= 0) continue;
          if (r.origId) {
            // existing row — update name/amount if changed
            const dbRow = (existing || []).find(e => e.id === r.origId);
            if (dbRow) {
              const nameChanged = dbRow.category !== name;
              const amtChanged = Number(dbRow.amount) !== amt;
              if (nameChanged || amtChanged) {
                const { error } = await supabase
                  .from('expenses')
                  .update({ category: name, amount: amt })
                  .eq('id', r.origId);
                if (error) throw error;
              }
            }
          } else {
            inserts.push({ store_id: st.id, month: tplMonth, category: name, amount: amt });
          }
        }
      }

      // Deletions for custom rows the user removed
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

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const hasStore = !!effectiveStoreId;
  const selectedStoreName = stores.find(s => s.id === effectiveStoreId)?.name;
  const singleFormInvalid = Object.keys(validate(form)).length > 0;

  const tryOpenAdd = () => {
    if (!hasStore) { setShowStorePicker('add'); return; }
    setForm(f => ({ ...f, store_id: effectiveStoreId }));
    setModal(true);
  };
  const tryOpenTemplate = () => {
    if (!hasStore) { setShowStorePicker('template'); return; }
    openTemplate();
  };

  // Compute store totals (fixed + custom) for the template modal footer.
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
  const templateStores = effectiveStoreId ? stores.filter(s => s.id === effectiveStoreId) : stores;
  const grandTotal = templateStores.reduce((s, st) => s + storeTotal(st), 0);

  return (
    <div>
      <PageHeader title="📋 Expenses" subtitle={hasStore ? selectedStoreName : 'All Stores'}>
        <Button variant="secondary" onClick={() => downloadCSV('expenses.csv', ['Month','Store','Category','Amount','Note'], items.map(e => [e.month, e.stores?.name, catLabel(e.category)?.label || e.category, e.amount, e.note]))} className="!text-[11px]">📥 CSV</Button>
        <Button variant="secondary" onClick={tryOpenTemplate}>📝 Fill Monthly</Button>
        <Button onClick={tryOpenAdd}>+ Add</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable
          emptyMessage="No expenses recorded. Use Fill Monthly to enter your bills quickly."
          columns={[
            { key: 'month', label: 'Month', render: v => monthLabel(v) },
            { key: 'store_id', label: 'Store', render: (_,r) => r.stores?.name },
            { key: 'category', label: 'Type', render: renderCatInTable },
            { key: 'amount', label: 'Amount', align: 'right', mono: true, render: v => <span className="text-sw-red">{fmt(v)}</span> },
            { key: 'note', label: 'Note' },
          ]}
          rows={items}
          isOwner={isOwner}
          onDelete={isOwner ? id => { const r = items.find(i => i.id === id); if (r) setConfirmDelete(r); } : undefined}
        />
      </div>

      {/* Single-expense form */}
      {modal && (
        <Modal title="Add Expense" onClose={() => { setModal(false); setErrors({}); }}>
          <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
            Store: <span className="text-sw-text font-semibold">{selectedStoreName || '—'}</span>
          </div>
          <Field label="Month">
            <input type="month" value={form.month} onChange={e => setForm({...form, month: e.target.value})} className={errors.month ? '!border-sw-red' : ''} />
            {errors.month && <p className="text-sw-red text-[11px] mt-1">{errors.month}</p>}
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={errors.category ? '!border-sw-red' : ''}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </Field>
          <Field label="Amount">
            <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
              onChange={e => setForm({...form, amount: e.target.value.replace(/^-/, '')})}
              className={errors.amount ? '!border-sw-red' : ''} />
            {errors.amount && <p className="text-sw-red text-[11px] mt-1">{errors.amount}</p>}
          </Field>
          <Field label="Note"><input value={form.note} onChange={e => setForm({...form, note: e.target.value})} placeholder="Optional" /></Field>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setModal(false); setErrors({}); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || singleFormInvalid}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Monthly template modal */}
      {tplOpen && (
        <Modal title="Fill Monthly Expenses" onClose={() => setTplOpen(false)} wide>
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <label className="text-sw-sub text-[11px] font-bold uppercase">Month</label>
            <input type="month" value={tplMonth} onChange={e => setTplMonth(e.target.value)} className="!w-auto md:!w-[160px]" />
            <span className="text-sw-dim text-[11px]">Blank rows are skipped. Custom expenses below each store support unique items.</span>
          </div>

          {tplLoading ? (
            <div className="py-8 text-center text-sw-dim">Loading template…</div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-auto pr-1">
              {(effectiveStoreId ? stores.filter(s => s.id === effectiveStoreId) : stores).map(st => {
                const total = storeTotal(st);
                return (
                  <div key={st.id} className="bg-sw-card2 rounded-lg border border-sw-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ background: st.color }} />
                        <span className="text-sw-text text-[13px] font-bold">{st.name}</span>
                      </div>
                      <span className="text-sw-green text-[12px] font-mono font-bold">{fmt(total)}</span>
                    </div>

                    {/* Fixed category grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                      {EXPENSE_CATEGORIES.map(cat => {
                        const key = `${st.id}:${cat.id}`;
                        return (
                          <div key={key}>
                            <label className="block text-sw-sub text-[10px] font-semibold mb-0.5">
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

                    {/* Custom expenses section */}
                    <div className="border-t border-sw-border pt-2">
                      <div className="text-sw-sub text-[10px] font-bold uppercase tracking-wide mb-1.5">Custom Expenses</div>
                      {(tplCustom[st.id] || []).length === 0 && (
                        <p className="text-sw-dim text-[11px] italic mb-1.5">No custom expenses — add below for items like camera repair, pest control, signage, etc.</p>
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
                              className="w-8 h-8 rounded-md bg-sw-redD text-sw-red border border-sw-red/30 flex items-center justify-center flex-shrink-0"
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
                        className="text-sw-blue text-[11px] font-semibold border border-sw-blue/30 rounded px-2 py-1 bg-sw-blueD hover:bg-sw-blue/20"
                      >
                        + Add Custom Expense
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-between items-center mt-4 sticky bottom-0 bg-sw-card pt-2 border-t border-sw-border">
            <div className="text-[11px] text-sw-sub">
              Grand total: <span className="text-sw-green font-mono font-bold text-[13px]">{fmt(grandTotal)}</span>
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

      {showStorePicker && (
        <StoreRequiredModal
          stores={stores}
          onCancel={() => setShowStorePicker(null)}
          onSelectStore={(s) => {
            setSelectedStore(s.id);
            const nextAction = showStorePicker;
            setShowStorePicker(null);
            if (nextAction === 'template') openTemplate();
            else {
              setForm(f => ({ ...f, store_id: s.id }));
              setModal(true);
            }
          }}
        />
      )}

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
