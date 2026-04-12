'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, PageHeader, Modal, Field, Button, Loading } from '@/components/UI';
import { fmt, monthLabel, downloadCSV, EXPENSE_CATEGORIES } from '@/lib/utils';

export default function ExpensesPage() {
  const { supabase, isOwner } = useAuth();
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const now = new Date();
  const [form, setForm] = useState({ store_id: '', month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`, category: 'power', amount: '', note: '' });

  const load = async () => {
    setLoading(true);
    const [{ data: st }, { data: e }] = await Promise.all([
      supabase.from('stores').select('*').order('created_at'),
      supabase.from('expenses').select('*, stores(name, color)').order('month', { ascending: false }),
    ]);
    setStores(st||[]); setItems(e||[]);
    if (!form.store_id && st?.length) setForm(f => ({...f, store_id: st[0].id}));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  const catLabel = id => EXPENSE_CATEGORIES.find(c => c.id === id);

  return (<div>
    <PageHeader title="📋 Expenses">
      <Button variant="secondary" onClick={() => downloadCSV('expenses.csv', ['Month','Store','Category','Amount','Note'], items.map(e => [e.month, e.stores?.name, catLabel(e.category)?.label, e.amount, e.note]))} className="!text-[11px]">📥 CSV</Button>
      <Button onClick={() => setModal(true)}>+ Add</Button>
    </PageHeader>
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'month', label: 'Month', render: v => monthLabel(v) },
        { key: 'store_id', label: 'Store', render: (_,r) => r.stores?.name },
        { key: 'category', label: 'Type', render: v => { const c = catLabel(v); return c ? `${c.icon} ${c.label}` : v; } },
        { key: 'amount', label: 'Amount', align: 'right', mono: true, render: v => <span className="text-sw-red">{fmt(v)}</span> },
        { key: 'note', label: 'Note' },
      ]} rows={items} isOwner={true} onDelete={async id => { await supabase.from('expenses').delete().eq('id', id); load(); }} />
    </div>
    {modal && <Modal title="Add Expense" onClose={() => setModal(false)}>
      <Field label="Store"><select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Month"><input type="month" value={form.month} onChange={e => setForm({...form, month: e.target.value})} /></Field>
      <Field label="Category"><select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>{EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}</select></Field>
      <Field label="Amount"><input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} /></Field>
      <Field label="Note"><input value={form.note} onChange={e => setForm({...form, note: e.target.value})} /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={async () => {
        const { error } = await supabase.from('expenses').insert({ ...form, amount: parseFloat(form.amount)||0 });
        if (error) { alert(error.message); return; } setModal(false); load();
      }}>Save</Button></div>
    </Modal>}
  </div>);
}
