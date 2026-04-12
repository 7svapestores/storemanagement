'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Modal, Field, Button, Loading } from '@/components/UI';

export default function TeamPage() {
  const { supabase, isOwner } = useAuth();
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'employee', store_id: '' });

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*, stores:store_id(name)'),
      supabase.from('stores').select('*').order('created_at'),
    ]);
    setUsers(p||[]); setStores(s||[]);
    if (!form.store_id && s?.length) setForm(f => ({...f, store_id: s[0].id}));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const handleAdd = async () => {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed'); return; }
    setModal(false); load();
  };

  return (<div>
    <PageHeader title="👥 Team"><Button onClick={() => setModal(true)}>+ Add User</Button></PageHeader>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
      {users.map(u => (<div key={u.id} className="bg-sw-card rounded-xl p-4 border border-sw-border">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold ${u.role === 'owner' ? 'bg-sw-blue text-black' : 'bg-sw-blueD text-sw-blue'}`}>{u.name?.[0]}</div>
          <div><div className="text-sw-text text-[13px] font-bold">{u.name}</div><div className="text-sw-dim text-[10px] capitalize">{u.role}{u.stores ? ` · ${u.stores.name}` : ''}</div></div>
        </div>
        <div className="text-[11px] text-sw-sub"><span className="font-mono">{u.username}</span>{u.role === 'employee' && <span className="text-sw-dim ml-1.5">• Sales only</span>}</div>
      </div>))}
    </div>
    {modal && <Modal title="Add User" onClose={() => setModal(false)}>
      <Field label="Name"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></Field>
      <Field label="Email"><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="user@storewise.app" /></Field>
      <Field label="Password"><input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} /></Field>
      <Field label="Role"><select value={form.role} onChange={e => setForm({...form, role: e.target.value})}><option value="employee">Employee (sales only)</option><option value="owner">Owner (full access)</option></select></Field>
      {form.role === 'employee' && <Field label="Store"><select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={handleAdd}>Add</Button></div>
    </Modal>}
  </div>);
}
