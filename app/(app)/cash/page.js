'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, StatCard, Loading, StoreBadge, Alert } from '@/components/UI';
import { fmt, fK, dayLabel, today } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

export default function CashPage() {
  const { supabase, isOwner, profile } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [recon, setRecon] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ store_id: '', date: today(), cash_collected: '', note: '' });
  const [expected, setExpected] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);
      const { data: sales } = await supabase.from('daily_sales').select('store_id, date, cash_sales').gte('date', range.start).lte('date', range.end);
      const { data: cash } = await supabase.from('cash_collections').select('*').gte('date', range.start).lte('date', range.end);
      const map = {};
      sales?.forEach(s => { const k = `${s.store_id}_${s.date}`; map[k] = { ...(map[k]||{}), store_id: s.store_id, date: s.date, cash_sales: (map[k]?.cash_sales||0) + s.cash_sales }; });
      cash?.forEach(c => { const k = `${c.store_id}_${c.date}`; map[k] = { ...(map[k]||{}), store_id: c.store_id, date: c.date, cash_collected: (map[k]?.cash_collected||0) + c.cash_collected }; });
      const rows = Object.values(map).map(r => {
        const cs = r.cash_sales||0, cc = r.cash_collected||0, so = +(cc-cs).toFixed(2);
        const store = st?.find(s => s.id === r.store_id);
        return { ...r, id: `${r.store_id}_${r.date}`, cash_sales: cs, cash_collected: cc, short_over: so, status: !cc ? 'pending' : Math.abs(so) < 0.01 ? 'matched' : so > 0 ? 'over' : 'short', store_name: store?.name, store_color: store?.color };
      }).sort((a,b) => b.date.localeCompare(a.date));
      setRecon(rows);
      if (!form.store_id && st?.length) setForm(f => ({...f, store_id: st[0].id}));
    } catch (e) {
      console.error('[cash] load failed:', e);
      setLoadError(e?.message || 'Failed to load cash data');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (form.store_id && form.date) supabase.from('daily_sales').select('cash_sales').eq('store_id', form.store_id).eq('date', form.date).then(({ data }) => setExpected(data?.reduce((s,r) => s + (r.cash_sales||0), 0) || 0));
  }, [form.store_id, form.date]);

  const handleSave = async () => {
    const cashCollected = parseFloat(form.cash_collected) || 0;
    const { error } = await supabase.from('cash_collections').upsert({ store_id: form.store_id, date: form.date, cash_collected: cashCollected, note: form.note, collected_by: profile?.id }, { onConflict: 'store_id,date' });
    if (error) { alert(error.message); return; }
    const storeName = stores.find(s => s.id === form.store_id)?.name;
    const wasEdit = modal === 'edit';
    await logActivity(supabase, profile, {
      action: wasEdit ? 'update' : 'create',
      entityType: 'cash_collection',
      description: `${profile?.name} ${wasEdit ? 'updated' : 'recorded'} cash collection of ${fmtMoney(cashCollected)} for ${storeName} on ${shortDate(form.date)}`,
      storeName,
    });
    setModal(null); load();
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  const totalShort = recon.filter(r => r.short_over < 0).reduce((s,r) => s + r.short_over, 0);
  const totalOver = recon.filter(r => r.short_over > 0).reduce((s,r) => s + r.short_over, 0);
  const statusBadge = v => { const c = { matched:'bg-sw-greenD text-sw-green', over:'bg-sw-greenD text-sw-green', short:'bg-sw-redD text-sw-red', pending:'bg-sw-amberD text-sw-amber' }[v]||''; return <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${c} uppercase`}>{v}</span>; };

  return (<div>
    <PageHeader title="🏦 Cash Collection" subtitle="Auto short/over vs sales"><Button onClick={() => { setForm({ store_id: stores[0]?.id||'', date: today(), cash_collected: '', note: '' }); setModal('add'); }}>+ Collect</Button></PageHeader>
    {loadError && <Alert type="error">{loadError}</Alert>}
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="flex gap-2.5 flex-wrap mb-3.5">
      <StatCard label="Total Short" value={fmt(totalShort)} icon="🔴" color="#F87171" />
      <StatCard label="Total Over" value={fmt(totalOver)} icon="🟢" color="#34D399" />
      <StatCard label="Pending" value={recon.filter(r=>r.status==='pending').length} icon="⏳" color="#FBBF24" />
      <StatCard label="Matched" value={recon.filter(r=>r.status==='matched').length} icon="✅" color="#34D399" />
    </div>
    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable columns={[
        { key: 'date', label: 'Date', render: v => dayLabel(v) },
        { key: 'store_name', label: 'Store', render: (v,r) => <StoreBadge name={v} color={r.store_color} /> },
        { key: 'cash_sales', label: 'Expected', align: 'right', mono: true, render: v => fmt(v) },
        { key: 'cash_collected', label: 'Collected', align: 'right', mono: true, render: v => v ? <span className="text-sw-blue font-semibold">{fmt(v)}</span> : <span className="text-sw-dim">—</span> },
        { key: 'short_over', label: 'Short/Over', align: 'right', mono: true, render: (v,r) => r.status === 'pending' ? <span className="text-sw-amber text-[10px]">PENDING</span> : <span className={v >= 0 ? 'text-sw-green font-bold' : 'text-sw-red font-bold'}>{v >= 0 ? '+' : ''}{fmt(v)}</span> },
        { key: 'status', label: 'Status', align: 'center', render: v => statusBadge(v) },
      ]} rows={recon} isOwner={true} onEdit={r => { setForm({ store_id: r.store_id, date: r.date, cash_collected: r.cash_collected, note: '' }); setModal('edit'); }} />
    </div>
    {modal && <Modal title={modal==='edit'?'Edit':'Collect Cash'} onClose={() => setModal(null)}>
      <Field label="Store"><select value={form.store_id} onChange={e => setForm({...form, store_id: e.target.value})}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></Field>
      {expected > 0 && <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border"><div className="flex justify-between"><span className="text-sw-sub text-xs">Expected</span><span className="text-sw-text font-bold font-mono">{fmt(expected)}</span></div></div>}
      <Field label="Cash Collected"><input type="number" value={form.cash_collected} onChange={e => setForm({...form, cash_collected: e.target.value})} className="!text-lg !py-3 !font-mono !font-bold" /></Field>
      <Field label="Note"><input value={form.note} onChange={e => setForm({...form, note: e.target.value})} /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button onClick={handleSave}>Save</Button></div>
    </Modal>}
  </div>);
}
