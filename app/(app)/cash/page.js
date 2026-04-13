'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, StatCard, Loading, StoreBadge, Alert, StoreRequiredModal } from '@/components/UI';
import { fmt, fK, dayLabel, today } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

export default function CashPage() {
  const { supabase, isOwner, profile, effectiveStoreId, setSelectedStore } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [recon, setRecon] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [form, setForm] = useState({ date: today(), cash_collected: '', note: '' });
  const [expected, setExpected] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);
      let salesQ = supabase.from('daily_sales').select('store_id, date, cash_sales').gte('date', range.start).lte('date', range.end);
      let cashQ = supabase.from('cash_collections').select('*').gte('date', range.start).lte('date', range.end);
      if (effectiveStoreId) {
        salesQ = salesQ.eq('store_id', effectiveStoreId);
        cashQ = cashQ.eq('store_id', effectiveStoreId);
      }
      const { data: sales } = await salesQ;
      const { data: cash } = await cashQ;
      const map = {};
      sales?.forEach(s => { const k = `${s.store_id}_${s.date}`; map[k] = { ...(map[k]||{}), store_id: s.store_id, date: s.date, cash_sales: (map[k]?.cash_sales||0) + s.cash_sales }; });
      cash?.forEach(c => { const k = `${c.store_id}_${c.date}`; map[k] = { ...(map[k]||{}), store_id: c.store_id, date: c.date, cash_collected: (map[k]?.cash_collected||0) + c.cash_collected }; });
      const rows = Object.values(map).map(r => {
        const cs = r.cash_sales||0, cc = r.cash_collected||0, so = +(cc-cs).toFixed(2);
        const store = st?.find(s => s.id === r.store_id);
        return { ...r, id: `${r.store_id}_${r.date}`, cash_sales: cs, cash_collected: cc, short_over: so, status: !cc ? 'pending' : Math.abs(so) < 0.01 ? 'matched' : so > 0 ? 'over' : 'short', store_name: store?.name, store_color: store?.color };
      }).sort((a,b) => b.date.localeCompare(a.date));
      setRecon(rows);
    } catch (e) {
      console.error('[cash] load failed:', e);
      setLoadError(e?.message || 'Failed to load cash data');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, effectiveStoreId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (effectiveStoreId && form.date) {
      supabase.from('daily_sales').select('cash_sales')
        .eq('store_id', effectiveStoreId).eq('date', form.date)
        .then(({ data }) => setExpected(data?.reduce((s,r) => s + (r.cash_sales||0), 0) || 0));
    }
  }, [effectiveStoreId, form.date]);

  const handleSave = async () => {
    if (!effectiveStoreId) { alert('Select a store from the sidebar first.'); return; }
    const cashCollected = parseFloat(form.cash_collected) || 0;
    const { error } = await supabase.from('cash_collections').upsert({
      store_id: effectiveStoreId, date: form.date, cash_collected: cashCollected, note: form.note, collected_by: profile?.id,
    }, { onConflict: 'store_id,date' });
    if (error) { alert(error.message); return; }
    const storeName = stores.find(s => s.id === effectiveStoreId)?.name;
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

  const hasStore = !!effectiveStoreId;
  const storeName = stores.find(s => s.id === effectiveStoreId)?.name;

  const tryOpenCollect = () => {
    if (!hasStore) { setShowStorePicker(true); return; }
    setForm({ date: today(), cash_collected: '', note: '' });
    setModal('add');
  };

  return (<div>
    <PageHeader title="🏦 Cash Collection" subtitle={hasStore ? `${storeName} · Auto short/over vs sales` : 'All Stores · Auto short/over vs sales'}>
      <Button onClick={tryOpenCollect}>+ Collect</Button>
    </PageHeader>
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
      ]} rows={recon} isOwner={isOwner} onEdit={isOwner ? r => { setForm({ date: r.date, cash_collected: r.cash_collected, note: '' }); setModal('edit'); } : undefined} />
    </div>
    {modal && <Modal title={modal==='edit'?'Edit':'Collect Cash'} onClose={() => setModal(null)}>
      <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
        Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
      </div>
      <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></Field>
      {expected > 0 && <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border"><div className="flex justify-between"><span className="text-sw-sub text-xs">Expected</span><span className="text-sw-text font-bold font-mono">{fmt(expected)}</span></div></div>}
      <Field label="Cash Collected"><input type="number" value={form.cash_collected} onChange={e => setForm({...form, cash_collected: e.target.value})} className="!text-lg !py-3 !font-mono !font-bold" /></Field>
      <Field label="Note"><input value={form.note} onChange={e => setForm({...form, note: e.target.value})} /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button onClick={handleSave}>Save</Button></div>
    </Modal>}
    {showStorePicker && (
      <StoreRequiredModal
        stores={stores}
        onCancel={() => setShowStorePicker(false)}
        onSelectStore={(s) => {
          setSelectedStore(s.id);
          setShowStorePicker(false);
          setForm({ date: today(), cash_collected: '', note: '' });
          setModal('add');
        }}
      />
    )}
  </div>);
}
