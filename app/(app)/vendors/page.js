'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Modal, Field, Button, Loading } from '@/components/UI';

export default function VendorsPage() {
  const { supabase, isOwner } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name:'', contact:'', phone:'', email:'', category:'' });

  const load = async () => { setLoading(true); const { data } = await supabase.from('vendors').select('*').order('name'); setVendors(data||[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  return (<div>
    <PageHeader title="🤝 Vendors"><Button onClick={() => setModal(true)}>+ Add</Button></PageHeader>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {vendors.map(v => (<div key={v.id} className="bg-[var(--bg-elevated)] rounded-xl p-4 border border-[var(--border-subtle)]">
        <div className="text-[var(--text-primary)] text-[15px] font-bold mb-1">{v.name}</div>
        <div className="text-[var(--text-secondary)] text-xs mb-2.5">{v.category}</div>
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between"><span className="text-[var(--text-muted)]">Contact</span><span className="text-[var(--text-primary)]">{v.contact}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-muted)]">Phone</span><span className="text-[var(--text-primary)] font-mono">{v.phone}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-muted)]">Email</span><span className="text-[var(--color-info)]">{v.email}</span></div>
        </div>
      </div>))}
    </div>
    {modal && <Modal title="Add Vendor" onClose={() => setModal(false)}>
      <Field label="Company Name"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></Field>
      <Field label="Contact"><input value={form.contact} onChange={e => setForm({...form, contact: e.target.value})} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Phone"><input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></Field>
        <Field label="Email"><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></Field>
      </div>
      <Field label="Category"><input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="e.g. Vapes, Tobacco" /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={async () => {
        const { error } = await supabase.from('vendors').insert(form);
        if (error) { alert(error.message); return; } setModal(false); load();
      }}>Add</Button></div>
    </Modal>}
  </div>);
}
