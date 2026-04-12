'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Field, Button, Loading } from '@/components/UI';

const colors = ['#F87171','#60A5FA','#34D399','#FBBF24','#C084FC','#FB7185','#FB923C','#38BDF8','#4ADE80','#E879F9'];

export default function SettingsPage() {
  const { supabase, isOwner } = useAuth();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', color: '#60A5FA', email: '' });

  const load = async () => { setLoading(true); const { data } = await supabase.from('stores').select('*').order('created_at'); setStores(data||[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  return (<div>
    <PageHeader title="⚙️ Settings" />
    <div className="bg-sw-card rounded-xl p-5 border border-sw-border">
      <h3 className="text-sw-text text-sm font-bold mb-3">Stores ({stores.length})</h3>
      {stores.map(s => (<div key={s.id} className="flex items-center gap-2 py-1.5 px-2.5 mb-1 bg-sw-card2 rounded-md">
        <div className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
        <span className="text-sw-text text-xs flex-1">{s.name}</span>
        <span className="text-sw-dim text-[10px]">{s.email||''}</span>
      </div>))}
      <div className="flex gap-2 items-end mt-3.5">
        <div className="flex-1"><Field label="Store Name"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="New store" /></Field></div>
        <div className="flex-1"><Field label="Email"><input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="store@email.com" /></Field></div>
        <div className="flex gap-1 mb-3.5">{colors.map(c => <button key={c} onClick={() => setForm({...form, color: c})} className="w-[18px] h-[18px] rounded cursor-pointer" style={{ background: c, border: form.color === c ? '2px solid #fff' : '2px solid transparent' }} />)}</div>
        <Button onClick={async () => { if (!form.name.trim()) return; const { error } = await supabase.from('stores').insert({ name: form.name, color: form.color, email: form.email }); if (error) { alert(error.message); return; } setForm({ name: '', color: '#60A5FA', email: '' }); load(); }} className="mb-3.5">Add</Button>
      </div>
    </div>
  </div>);
}
