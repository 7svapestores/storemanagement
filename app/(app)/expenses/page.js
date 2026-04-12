'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, Loading, ConfirmModal, Alert } from '@/components/UI';
import { fmt, monthLabel, downloadCSV, EXPENSE_CATEGORIES } from '@/lib/utils';
import { logActivity, fmtMoney } from '@/lib/activity';

const now0 = new Date();
const curMonth = `${now0.getFullYear()}-${String(now0.getMonth()+1).padStart(2,'0')}`;
const prevMonthStr = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
};

export default function ExpensesPage() {
  const { supabase, isOwner, profile } = useAuth();
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
  const [tplData, setTplData] = useState({}); // { `${storeId}:${categoryId}`: amount }
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: st }, { data: e }] = await Promise.all([
        supabase.from('stores').select('*').order('created_at'),
        supabase.from('expenses').select('*, stores(name, color)').order('month', { ascending: false }),
      ]);
      setStores(st || []); setItems(e || []);
      if (!form.store_id && st?.length) setForm(f => ({ ...f, store_id: st[0].id }));
    } catch (err) {
      console.error('[expenses] load failed:', err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const catLabel = id => EXPENSE_CATEGORIES.find(c => c.id === id);

  // ── Single-expense form validation ──────────────────────────
  const validate = (f) => {
    const e = {};
    if (!f.store_id) e.store_id = 'Store is required';
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
      description: `${profile?.name} deleted expense ${catLabel(row.category)?.label || row.category} of ${fmtMoney(row.amount)} for ${row.stores?.name} (${row.month})`,
      storeName: row.stores?.name,
      metadata: { deleted: row },
    });
    setConfirmDelete(null);
    load();
  };

  // ── Monthly template ────────────────────────────────────────
  const openTemplate = async () => {
    setTplOpen(true);
    setTplLoading(true);
    setTplMonth(curMonth);
    try {
      // Prefill from the chosen month first; if empty, fall back to previous month.
      const months = [curMonth, prevMonthStr()];
      const { data } = await supabase
        .from('expenses')
        .select('store_id, category, amount, month')
        .in('month', months);

      const byCur = {};
      const byPrev = {};
      (data || []).forEach(r => {
        const key = `${r.store_id}:${r.category}`;
        if (r.month === curMonth) byCur[key] = r.amount;
        else byPrev[key] = r.amount;
      });

      const seeded = {};
      for (const st of stores) {
        for (const cat of EXPENSE_CATEGORIES) {
          const key = `${st.id}:${cat.id}`;
          const v = byCur[key] ?? byPrev[key] ?? '';
          seeded[key] = v === '' ? '' : String(v);
        }
      }
      setTplData(seeded);
    } catch (e) {
      console.error('[expenses] template prefill failed:', e);
    } finally {
      setTplLoading(false);
    }
  };

  // Re-prefill when tplMonth changes while template is open
  useEffect(() => {
    if (!tplOpen) return;
    (async () => {
      setTplLoading(true);
      try {
        // previous month relative to tplMonth
        const [y, m] = tplMonth.split('-').map(Number);
        const prev = new Date(y, m - 2, 1);
        const prevKey = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
        const { data } = await supabase
          .from('expenses')
          .select('store_id, category, amount, month')
          .in('month', [tplMonth, prevKey]);
        const byCur = {}, byPrev = {};
        (data || []).forEach(r => {
          const key = `${r.store_id}:${r.category}`;
          if (r.month === tplMonth) byCur[key] = r.amount;
          else byPrev[key] = r.amount;
        });
        const seeded = {};
        for (const st of stores) {
          for (const cat of EXPENSE_CATEGORIES) {
            const key = `${st.id}:${cat.id}`;
            const v = byCur[key] ?? byPrev[key] ?? '';
            seeded[key] = v === '' ? '' : String(v);
          }
        }
        setTplData(seeded);
      } finally {
        setTplLoading(false);
      }
    })();
  }, [tplMonth]);

  const saveTemplate = async () => {
    setTplSaving(true);
    try {
      const inserts = [];
      const updates = [];

      // Fetch existing rows for the month so we can update vs insert.
      const { data: existing } = await supabase
        .from('expenses')
        .select('id, store_id, category, amount')
        .eq('month', tplMonth);
      const existingByKey = {};
      (existing || []).forEach(r => {
        existingByKey[`${r.store_id}:${r.category}`] = r;
      });

      for (const st of stores) {
        for (const cat of EXPENSE_CATEGORIES) {
          const key = `${st.id}:${cat.id}`;
          const raw = tplData[key];
          if (raw === '' || raw == null) continue;
          const amt = parseFloat(raw);
          if (isNaN(amt) || amt <= 0) continue;
          const existingRow = existingByKey[key];
          if (existingRow) {
            if (Number(existingRow.amount) !== amt) {
              updates.push({ id: existingRow.id, amount: amt });
            }
          } else {
            inserts.push({ store_id: st.id, month: tplMonth, category: cat.id, amount: amt });
          }
        }
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
        description: `${profile?.name} saved monthly expense template for ${tplMonth} — ${inserts.length} new, ${updates.length} updated across ${stores.length} stores`,
        metadata: { month: tplMonth, inserts: inserts.length, updates: updates.length },
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

  const singleFormInvalid = Object.keys(validate(form)).length > 0;

  return (
    <div>
      <PageHeader title="📋 Expenses">
        <Button variant="secondary" onClick={() => downloadCSV('expenses.csv', ['Month','Store','Category','Amount','Note'], items.map(e => [e.month, e.stores?.name, catLabel(e.category)?.label, e.amount, e.note]))} className="!text-[11px]">📥 CSV</Button>
        <Button variant="secondary" onClick={openTemplate}>📝 Fill Monthly</Button>
        <Button onClick={() => setModal(true)}>+ Add</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable columns={[
          { key: 'month', label: 'Month', render: v => monthLabel(v) },
          { key: 'store_id', label: 'Store', render: (_,r) => r.stores?.name },
          { key: 'category', label: 'Type', render: v => { const c = catLabel(v); return c ? `${c.icon} ${c.label}` : v; } },
          { key: 'amount', label: 'Amount', align: 'right', mono: true, render: v => <span className="text-sw-red">{fmt(v)}</span> },
          { key: 'note', label: 'Note' },
        ]} rows={items} isOwner={true} onDelete={id => { const r = items.find(i => i.id === id); if (r) setConfirmDelete(r); }} />
      </div>

      {/* Single-expense form */}
      {modal && (
        <Modal title="Add Expense" onClose={() => { setModal(false); setErrors({}); }}>
          <Field label="Store">
            <select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})} className={errors.store_id ? '!border-sw-red' : ''}>
              <option value="">Select store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.store_id && <p className="text-sw-red text-[11px] mt-1">{errors.store_id}</p>}
          </Field>
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
            <span className="text-sw-dim text-[11px]">Empty rows are skipped. Existing values are updated.</span>
          </div>

          {tplLoading ? (
            <div className="py-8 text-center text-sw-dim">Loading template…</div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-auto pr-1">
              {stores.map(st => (
                <div key={st.id} className="bg-sw-card2 rounded-lg border border-sw-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-sm" style={{ background: st.color }} />
                    <span className="text-sw-text text-[13px] font-bold">{st.name}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end mt-4 sticky bottom-0 bg-sw-card pt-2">
            <Button variant="secondary" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate} disabled={tplSaving || tplLoading}>
              {tplSaving ? 'Saving…' : 'Save All Expenses'}
            </Button>
          </div>
        </Modal>
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
