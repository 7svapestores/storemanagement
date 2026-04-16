'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, StatCard, Loading, StoreBadge, Alert, ConfirmModal, MultiSelect } from '@/components/UI';
import { fmt, fK, dayLabel, today } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

const STATUS_OPTIONS = [
  { value: 'matched', label: 'Matched' },
  { value: 'over', label: 'Over' },
  { value: 'short', label: 'Short' },
  { value: 'pending', label: 'Pending' },
];

const statusBadge = v => {
  const styles = {
    matched: { background: '#3B82F6', color: '#FFFFFF' },
    over:    { background: '#22C55E', color: '#FFFFFF' },
    short:   { background: '#EF4444', color: '#FFFFFF' },
    pending: { background: '#F59E0B', color: '#1A1A2E' },
  };
  const s = styles[v] || {};
  return (
    <span
      style={{ ...s, fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}
    >
      {v}
    </span>
  );
};

export default function CashPage() {
  const { supabase, isOwner, profile, effectiveStoreId } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [recon, setRecon] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Page-level filters
  const [storeFilter, setStoreFilter] = useState(effectiveStoreId ? [effectiveStoreId] : []);
  const [statusFilter, setStatusFilter] = useState([]);
  const [search, setSearch] = useState('');

  // Modal form
  const [formStoreId, setFormStoreId] = useState('');
  const [form, setForm] = useState({ date: today(), cash_collected: '', note: '' });
  const [expected, setExpected] = useState(0);

  useEffect(() => {
    if (effectiveStoreId) setStoreFilter([effectiveStoreId]);
  }, [effectiveStoreId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);
      let salesQ = supabase.from('daily_sales').select('store_id, date, cash_sales').gte('date', range.start).lte('date', range.end);
      let cashQ = supabase.from('cash_collections').select('*').gte('date', range.start).lte('date', range.end);
      if (storeFilter.length) {
        salesQ = salesQ.in('store_id', storeFilter);
        cashQ = cashQ.in('store_id', storeFilter);
      }
      const { data: sales } = await salesQ;
      const { data: cash } = await cashQ;
      const map = {};
      sales?.forEach(s => { const k = `${s.store_id}_${s.date}`; map[k] = { ...(map[k]||{}), store_id: s.store_id, date: s.date, cash_sales: (map[k]?.cash_sales||0) + s.cash_sales }; });
      cash?.forEach(c => { const k = `${c.store_id}_${c.date}`; map[k] = { ...(map[k]||{}), store_id: c.store_id, date: c.date, cash_collected: (map[k]?.cash_collected||0) + c.cash_collected, note: c.note || (map[k]?.note || ''), cash_id: c.id }; });
      const rows = Object.values(map).map(r => {
        const cs = r.cash_sales||0, cc = r.cash_collected||0, so = +(cc-cs).toFixed(2);
        const store = st?.find(s => s.id === r.store_id);
        return { ...r, id: r.cash_id || `${r.store_id}_${r.date}`, cash_sales: cs, cash_collected: cc, short_over: so, status: !cc ? 'pending' : Math.abs(so) < 0.01 ? 'matched' : so > 0 ? 'over' : 'short', store_name: store?.name, store_color: store?.color };
      });
      setRecon(rows);
    } catch (e) {
      console.error('[cash] load failed:', e);
      setLoadError(e?.message || 'Failed to load cash data');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, storeFilter.join(',')]);

  useEffect(() => { load(); }, [load]);

  // Fetch expected cash for the selected store + date in modal
  useEffect(() => {
    if (formStoreId && form.date) {
      supabase.from('daily_sales').select('cash_sales')
        .eq('store_id', formStoreId).eq('date', form.date)
        .then(({ data }) => setExpected(data?.reduce((s,r) => s + (r.cash_sales||0), 0) || 0));
    } else {
      setExpected(0);
    }
  }, [formStoreId, form.date]);

  const handleSave = async () => {
    if (!formStoreId) { alert('Select a store first.'); return; }
    const cashCollected = parseFloat(form.cash_collected) || 0;
    const { error } = await supabase.from('cash_collections').upsert({
      store_id: formStoreId, date: form.date, cash_collected: cashCollected, note: form.note, collected_by: profile?.id,
    }, { onConflict: 'store_id,date' });
    if (error) { alert(error.message); return; }
    const storeName = stores.find(s => s.id === formStoreId)?.name;
    const wasEdit = modal === 'edit';
    await logActivity(supabase, profile, {
      action: wasEdit ? 'update' : 'create',
      entityType: 'cash_collection',
      description: `${profile?.name} ${wasEdit ? 'updated' : 'recorded'} cash collection of ${fmtMoney(cashCollected)} for ${storeName} on ${shortDate(form.date)}`,
      storeName,
    });
    setModal(null);
    setEditRow(null);
    load();
  };

  const doDelete = async () => {
    const row = confirmDelete;
    if (!row) return;
    const { error } = await supabase.from('cash_collections').delete().eq('store_id', row.store_id).eq('date', row.date);
    if (error) { alert(error.message); setConfirmDelete(null); return; }
    const storeName = stores.find(s => s.id === row.store_id)?.name;
    await logActivity(supabase, profile, {
      action: 'delete',
      entityType: 'cash_collection',
      description: `${profile?.name} deleted cash collection of ${fmtMoney(row.cash_collected)} for ${storeName} on ${shortDate(row.date)}`,
      storeName,
      metadata: { deleted: row },
    });
    setConfirmDelete(null);
    load();
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;
  // Client-side filters: status + search
  const visibleRows = recon.filter(r => {
    if (statusFilter.length && !statusFilter.includes(r.status)) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [
        (r.store_name || '').toLowerCase(),
        String(r.cash_sales ?? ''),
        String(r.cash_collected ?? ''),
        String(r.short_over ?? ''),
        (r.note || '').toLowerCase(),
        r.date || '',
        r.status || '',
      ].join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totalExpected = visibleRows.reduce((s,r) => s + (r.cash_sales||0), 0);
  const totalCollected = visibleRows.reduce((s,r) => s + (r.cash_collected||0), 0);
  const totalCashInHand = visibleRows.reduce((s,r) => s + (r.cash_collected||0), 0);
  const totalShort = visibleRows.filter(r => r.short_over < 0).reduce((s,r) => s + r.short_over, 0);
  const totalOver = visibleRows.filter(r => r.short_over > 0).reduce((s,r) => s + r.short_over, 0);
  const pendingCount = visibleRows.filter(r => r.status === 'pending').length;
  const matchedCount = visibleRows.filter(r => r.status === 'matched').length;

  const singleStoreId = storeFilter.length === 1 ? storeFilter[0] : '';
  const storeName = stores.find(s => s.id === singleStoreId)?.name;

  const tryOpenCollect = () => {
    setEditRow(null);
    setFormStoreId(singleStoreId || '');
    setForm({ date: today(), cash_collected: '', note: '' });
    setModal('add');
  };

  const openEdit = (r) => {
    setEditRow(r);
    setFormStoreId(r.store_id || singleStoreId || '');
    setForm({ date: r.date, cash_collected: String(r.cash_collected || ''), note: r.note || '' });
    setModal('edit');
  };

  return (<div>
    <PageHeader title="🏦 Cash Collection" subtitle={singleStoreId ? `${storeName} · Auto short/over vs sales` : 'All Stores · Auto short/over vs sales'}>
      <Button onClick={tryOpenCollect}>+ Collect</Button>
    </PageHeader>
    {loadError && <Alert type="error">{loadError}</Alert>}
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

    {/* Filter bar */}
    <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
      <MultiSelect
        label="Store"
        placeholder="All Stores"
        unitLabel="store"
        value={storeFilter}
        onChange={setStoreFilter}
        options={stores.map(s => ({ value: s.id, label: s.name }))}
      />
      <MultiSelect
        label="Status"
        placeholder="All Statuses"
        unitLabel="status"
        value={statusFilter}
        onChange={setStatusFilter}
        options={STATUS_OPTIONS}
      />
      <input
        type="text"
        placeholder="Search… (store, amount, notes)"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="!w-full sm:!flex-1 sm:!min-w-[240px] !py-1.5 !text-[11px]"
      />
      {(storeFilter.length > 0 || statusFilter.length > 0 || search) && (
        <button onClick={() => { setStoreFilter([]); setStatusFilter([]); setSearch(''); }} className="text-sw-dim text-[10px] underline">clear</button>
      )}
    </div>

    {/* Stat cards — fed by filtered rows */}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-3.5">
      <StatCard label="Cash in Hand" value={fmt(totalCashInHand)} icon="💰" color="#60A5FA" />
      <StatCard label="Total Short" value={fmt(totalShort)} icon="🔴" color="#F87171" />
      <StatCard label="Total Over" value={fmt(totalOver)} icon="🟢" color="#34D399" />
      <StatCard label="Pending" value={pendingCount} icon="⏳" color="#FBBF24" />
      <StatCard label="Matched" value={matchedCount} icon="✅" color="#34D399" />
    </div>

    <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
      <DataTable
        defaultSort={{ key: 'date', dir: 'desc' }}
        columns={[
          { key: 'date', label: 'Date', render: v => dayLabel(v) },
          { key: 'store_name', label: 'Store', render: (v,r) => <StoreBadge name={v} color={r.store_color} />, sortValue: r => r.store_name || '' },
          { key: 'cash_sales', label: 'Expected', align: 'right', mono: true, render: v => fmt(v), sortValue: r => Number(r.cash_sales || 0) },
          { key: 'cash_collected', label: 'Collected', align: 'right', mono: true, render: v => v ? <span className="text-sw-blue font-semibold">{fmt(v)}</span> : <span className="text-sw-dim">—</span>, sortValue: r => Number(r.cash_collected || 0) },
          { key: 'short_over', label: 'Short/Over', align: 'right', mono: true, render: (v,r) => r.status === 'pending' ? <span className="text-sw-amber text-[10px]">PENDING</span> : <span className={v >= 0 ? 'text-sw-green font-bold' : 'text-sw-red font-bold'}>{v >= 0 ? '+' : ''}{fmt(v)}</span>, sortValue: r => Number(r.short_over || 0) },
          { key: 'status', label: 'Status', align: 'center', render: v => statusBadge(v) },
        ]}
        rows={visibleRows}
        isOwner={isOwner}
        onEdit={isOwner ? openEdit : undefined}
        onDelete={isOwner ? id => { const r = visibleRows.find(i => i.id === id); if (r) setConfirmDelete(r); } : undefined}
      />
      {visibleRows.length > 0 && (
        <div className="px-3 py-2 border-t border-sw-border bg-sw-card2">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <span className="text-sw-sub text-[11px] font-bold uppercase tracking-wide">
              Showing {visibleRows.length} of {recon.length} records
            </span>
            <div className="flex gap-4 items-center">
              <span className="text-sw-sub text-[11px]">Expected: <span className="text-sw-text font-mono font-bold">{fmt(totalExpected)}</span></span>
              <span className="text-sw-sub text-[11px]">Collected: <span className="text-sw-blue font-mono font-bold">{fmt(totalCollected)}</span></span>
              <span className="text-sw-sub text-[11px]">Net: <span className={`font-mono font-bold ${totalCollected - totalExpected >= 0 ? 'text-sw-green' : 'text-sw-red'}`}>{totalCollected - totalExpected >= 0 ? '+' : ''}{fmt(totalCollected - totalExpected)}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Collect / Edit modal */}
    {modal && <Modal title={modal==='edit' ? 'Edit Cash Collection' : 'Collect Cash'} onClose={() => { setModal(null); setEditRow(null); }}>
      <Field label="Store">
        <select
          value={formStoreId}
          onChange={e => setFormStoreId(e.target.value)}
          style={!formStoreId ? { borderColor: '#F87171' } : undefined}
        >
          <option value="">Select store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!formStoreId && <div className="text-sw-red text-[11px] font-semibold mt-1">Please select a store</div>}
      </Field>
      <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></Field>
      {expected > 0 && <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border"><div className="flex justify-between"><span className="text-sw-sub text-xs">Expected</span><span className="text-sw-text font-bold font-mono">{fmt(expected)}</span></div></div>}
      <Field label="Cash Collected"><input type="number" value={form.cash_collected} onChange={e => setForm({...form, cash_collected: e.target.value})} className="!text-lg !py-3 !font-mono !font-bold" /></Field>
      <Field label="Note"><input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => { setModal(null); setEditRow(null); }}>Cancel</Button><Button onClick={handleSave}>Save</Button></div>
    </Modal>}

    {confirmDelete && (
      <ConfirmModal
        title="Delete this cash collection?"
        message={`Delete ${fmtMoney(confirmDelete.cash_collected)} collected for ${confirmDelete.store_name || 'store'} on ${shortDate(confirmDelete.date)}? This will be logged.`}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    )}
  </div>);
}
