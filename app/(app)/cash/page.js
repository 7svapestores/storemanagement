'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, Modal, Field, Button, Loading, StoreBadge, Alert, MultiSelect, SmartDatePicker, SortDropdown } from '@/components/UI';
import { V2StatCard } from '@/components/ui';
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

  // Page-level filters
  const [storeFilter, setStoreFilter] = useState(effectiveStoreId ? [effectiveStoreId] : []);
  const [statusFilter, setStatusFilter] = useState([]);
  const [search, setSearch] = useState('');

  // Sort
  const [sortState, setSortState] = useState({ key: 'date', dir: 'desc' });
  const cashSortOptions = [
    { label: 'Date (newest)', key: 'date', dir: 'desc' },
    { label: 'Date (oldest)', key: 'date', dir: 'asc' },
    { label: 'Store A-Z', key: 'store_name', dir: 'asc' },
    { label: 'Store Z-A', key: 'store_name', dir: 'desc' },
    { label: 'Expected (high-low)', key: 'expected', dir: 'desc' },
    { label: 'Expected (low-high)', key: 'expected', dir: 'asc' },
    { label: 'Status (priority)', key: 'status', dir: 'asc' },
  ];

  // Modal form
  const [formStoreId, setFormStoreId] = useState('');
  const [form, setForm] = useState({ date: today(), cash_collected: '', note: '' });
  const [expectedBreakdown, setExpectedBreakdown] = useState({ r1: 0, r2: 0, total: 0 });

  useEffect(() => {
    if (effectiveStoreId) setStoreFilter([effectiveStoreId]);
  }, [effectiveStoreId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: st } = await supabase.from('stores').select('*').order('created_at');
      setStores(st || []);

      // Fetch safe-drop fields from daily_sales (the real "expected cash")
      let salesQ = supabase
        .from('daily_sales')
        .select('store_id, date, r1_safe_drop, r2_safe_drop')
        .gte('date', range.start).lte('date', range.end);
      let cashQ = supabase
        .from('cash_collections')
        .select('*')
        .gte('date', range.start).lte('date', range.end);
      if (storeFilter.length) {
        salesQ = salesQ.in('store_id', storeFilter);
        cashQ = cashQ.in('store_id', storeFilter);
      }
      const { data: sales } = await salesQ;
      const { data: cash } = await cashQ;

      const map = {};
      sales?.forEach(s => {
        const k = `${s.store_id}_${s.date}`;
        const prev = map[k] || {};
        map[k] = {
          ...prev,
          store_id: s.store_id,
          date: s.date,
          r1_safe_drop: (prev.r1_safe_drop || 0) + (s.r1_safe_drop || 0),
          r2_safe_drop: (prev.r2_safe_drop || 0) + (s.r2_safe_drop || 0),
        };
      });
      cash?.forEach(c => {
        const k = `${c.store_id}_${c.date}`;
        const prev = map[k] || {};
        map[k] = {
          ...prev,
          store_id: c.store_id,
          date: c.date,
          cash_collected: (prev.cash_collected || 0) + (c.cash_collected || 0),
          note: c.note || prev.note || '',
          cash_id: c.id,
        };
      });

      const rows = Object.values(map).map(r => {
        const r1 = r.r1_safe_drop || 0;
        const r2 = r.r2_safe_drop || 0;
        const expected = +(r1 + r2).toFixed(2);
        const cc = r.cash_collected || 0;
        const so = +(cc - expected).toFixed(2);
        const store = st?.find(s => s.id === r.store_id);
        return {
          ...r,
          id: r.cash_id || `${r.store_id}_${r.date}`,
          expected,
          r1_safe_drop: r1,
          r2_safe_drop: r2,
          cash_collected: cc,
          short_over: so,
          status: !cc ? 'pending' : Math.abs(so) < 0.01 ? 'matched' : so > 0 ? 'over' : 'short',
          store_name: store?.name,
          store_color: store?.color,
          has_r2: !!store?.has_register2,
        };
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

  // Fetch expected breakdown for the selected store + date in modal
  useEffect(() => {
    if (formStoreId && form.date) {
      supabase.from('daily_sales')
        .select('r1_safe_drop, r2_safe_drop')
        .eq('store_id', formStoreId)
        .eq('date', form.date)
        .then(({ data }) => {
          const r1 = (data || []).reduce((s, r) => s + (r.r1_safe_drop || 0), 0);
          const r2 = (data || []).reduce((s, r) => s + (r.r2_safe_drop || 0), 0);
          setExpectedBreakdown({ r1, r2, total: r1 + r2 });
        });
    } else {
      setExpectedBreakdown({ r1: 0, r2: 0, total: 0 });
    }
  }, [formStoreId, form.date]);

  const handleSave = async () => {
    if (!formStoreId) { alert('Select a store first.'); return; }
    const cashCollected = parseFloat(form.cash_collected) || 0;
    const { error } = await supabase.from('cash_collections').upsert({
      store_id: formStoreId, date: form.date, cash_collected: cashCollected, note: form.note, collected_by: profile?.id,
    }, { onConflict: 'store_id,date' });
    if (error) { alert(error.message); return; }
    const stName = stores.find(s => s.id === formStoreId)?.name;
    const wasEdit = modal === 'edit';
    await logActivity(supabase, profile, {
      action: wasEdit ? 'update' : 'create',
      entityType: 'cash_collection',
      description: `${profile?.name} ${wasEdit ? 'updated' : 'recorded'} cash collection of ${fmtMoney(cashCollected)} for ${stName} on ${shortDate(form.date)}`,
      storeName: stName,
    });
    setModal(null);
    setEditRow(null);
    load();
  };


  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  // Client-side filters: status + search
  const visibleRows = recon.filter(r => {
    if (statusFilter.length && !statusFilter.includes(r.status)) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = [
        (r.store_name || '').toLowerCase(),
        String(r.expected ?? ''),
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

  const totalExpected = visibleRows.reduce((s,r) => s + (r.expected || 0), 0);
  const totalCollected = visibleRows.reduce((s,r) => s + (r.cash_collected || 0), 0);
  const totalCashInHand = totalCollected;
  const shortRows = visibleRows.filter(r => r.status === 'short');
  const overRows = visibleRows.filter(r => r.status === 'over');
  const totalShort = shortRows.reduce((s,r) => s + r.short_over, 0);
  const totalOver = overRows.reduce((s,r) => s + r.short_over, 0);
  const pendingRows = visibleRows.filter(r => r.status === 'pending');
  const pendingExpected = pendingRows.reduce((s,r) => s + (r.expected || 0), 0);
  const matchedRows = visibleRows.filter(r => r.status === 'matched');
  const matchedCollected = matchedRows.reduce((s,r) => s + (r.cash_collected || 0), 0);

  const singleStoreId = storeFilter.length === 1 ? storeFilter[0] : '';
  const storeName = stores.find(s => s.id === singleStoreId)?.name;
  const modalStore = stores.find(s => s.id === formStoreId);
  const modalDiff = (() => {
    const col = parseFloat(form.cash_collected);
    if (isNaN(col) || expectedBreakdown.total <= 0) return null;
    return +(col - expectedBreakdown.total).toFixed(2);
  })();

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
    {/* Header */}
    <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
      <div>
        <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider">Cash</p>
        <h1 className="text-[var(--text-primary)] text-[22px] font-bold tracking-tight">Cash Collection</h1>
        <p className="text-[var(--text-secondary)] text-[12px]">{singleStoreId ? storeName : 'All Stores'} · Auto short/over vs safe drops</p>
      </div>
      <Button onClick={tryOpenCollect}>+ Collect</Button>
    </div>
    {loadError && <Alert type="error">{loadError}</Alert>}
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

    {/* Filter bar */}
    <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
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
      <SortDropdown options={cashSortOptions} value={sortState} onChange={setSortState} />
      <input
        type="text"
        placeholder="Search… (store, amount, notes)"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="!w-full sm:!flex-1 sm:!min-w-[240px] !py-1.5 !text-[11px]"
      />
      {(storeFilter.length > 0 || statusFilter.length > 0 || search) && (
        <button onClick={() => { setStoreFilter([]); setStatusFilter([]); setSearch(''); }} className="text-[var(--text-muted)] text-[10px] underline">clear</button>
      )}
    </div>

    {/* Stat cards — fed by filtered rows */}
    {(() => {
      const netShortOver = totalShort + totalOver;
      const netVariant = Math.abs(netShortOver) < 0.01 ? 'default' : netShortOver > 0 ? 'success' : 'danger';
      const netValue = Math.abs(netShortOver) < 0.01 ? fmt(0) : netShortOver > 0 ? `+${fmt(netShortOver)}` : fmt(netShortOver);
      return (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <V2StatCard label="Expected Cash" value={fK(totalExpected)} sub="Total expected" icon="💵" variant="warning" />
          <V2StatCard label="Cash in Hand" value={fK(totalCashInHand)} sub="Collected so far" icon="💰" variant="info" />
          <V2StatCard label="Net Short/Over" value={netValue} sub={`${shortRows.length} short · ${overRows.length} over`} icon="📊" variant={netVariant} />
          <V2StatCard label="Pending" value={`${pendingRows.length} / ${fK(pendingExpected)}`} sub={`${pendingRows.length} pending`} icon="⏳" variant="warning" />
          <V2StatCard label="Matched" value={`${matchedRows.length} / ${fK(matchedCollected)}`} sub={`${matchedRows.length} reconciled`} icon="✅" variant="success" />
        </div>
      );
    })()}

    <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
      <DataTable
        sortState={sortState}
        onSortChange={setSortState}
        columns={[
          { key: 'date', label: 'Date', render: v => dayLabel(v) },
          { key: 'store_name', label: 'Store', render: (v,r) => <StoreBadge name={v} color={r.store_color} />, sortValue: r => r.store_name || '' },
          { key: 'expected', label: 'Expected', align: 'right', mono: true,
            render: (v, r) => (
              <span title={r.has_r2 ? `R1: ${fmt(r.r1_safe_drop)} + R2: ${fmt(r.r2_safe_drop)}` : `R1: ${fmt(r.r1_safe_drop)}`}>
                {fmt(v)}
              </span>
            ),
            sortValue: r => Number(r.expected || 0),
          },
          { key: 'cash_collected', label: 'Collected', align: 'right', mono: true, render: v => v ? <span className="text-[var(--color-info)] font-semibold">{fmt(v)}</span> : <span className="text-[var(--text-muted)]">—</span>, sortValue: r => Number(r.cash_collected || 0) },
          { key: 'short_over', label: 'Short/Over', align: 'right', mono: true, render: (v,r) => r.status === 'pending' ? <span className="text-[var(--color-warning)] text-[10px]">PENDING</span> : <span className={v >= 0 ? 'text-[var(--color-success)] font-bold' : 'text-[var(--color-danger)] font-bold'}>{v >= 0 ? '+' : ''}{fmt(v)}</span>, sortValue: r => Number(r.short_over || 0) },
          { key: 'status', label: 'Status', align: 'center', render: v => statusBadge(v), sortValue: r => ({ pending: 1, short: 2, over: 3, matched: 4 })[r.status] || 99 },
          ...(isOwner ? [{ key: '_action', label: '', align: 'right', sortable: false, render: (_, r) => (
            r.status === 'pending' ? (
              <button
                onClick={() => openEdit(r)}
                className="inline-flex items-center gap-1 px-3 rounded-md bg-sw-greenD border border-sw-green/30 text-[var(--color-success)] text-[12px] font-semibold"
                style={{ minHeight: 32 }}
              >
                💰 Collect
              </button>
            ) : (
              <button
                onClick={() => openEdit(r)}
                className="inline-flex items-center gap-1 px-3 rounded-md bg-sw-blueD border border-sw-blue/30 text-[var(--color-info)] text-[12px] font-semibold"
                style={{ minHeight: 32 }}
              >
                ✏️ Edit
              </button>
            )
          ) }] : []),
        ]}
        rows={visibleRows}
        isOwner={false}
      />
      {visibleRows.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <span className="text-[var(--text-secondary)] text-[11px] font-bold uppercase tracking-wide">
              Showing {visibleRows.length} of {recon.length} records
            </span>
            <div className="flex gap-4 items-center">
              <span className="text-[var(--text-secondary)] text-[11px]">Expected: <span className="text-[var(--text-primary)] font-mono font-bold">{fmt(totalExpected)}</span></span>
              <span className="text-[var(--text-secondary)] text-[11px]">Collected: <span className="text-[var(--color-info)] font-mono font-bold">{fmt(totalCollected)}</span></span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Collect / Edit modal */}
    {modal && <Modal title={modal==='edit' ? (editRow?.status === 'pending' ? `Collect Cash — ${editRow?.store_name || ''}` : 'Edit Cash Collection') : 'Collect Cash'} onClose={() => { setModal(null); setEditRow(null); }}>
      <Field label="Store">
        <select
          value={formStoreId}
          onChange={e => setFormStoreId(e.target.value)}
          style={!formStoreId ? { borderColor: '#F87171' } : undefined}
        >
          <option value="">Select store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!formStoreId && <div className="text-[var(--color-danger)] text-[11px] font-semibold mt-1">Please select a store</div>}
      </Field>
      <Field label="Date"><SmartDatePicker value={form.date} onChange={v => setForm({...form, date: v})} /></Field>

      {/* Expected breakdown */}
      {expectedBreakdown.total > 0 && (
        <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border">
          <div className="text-[var(--text-secondary)] text-[10px] font-bold uppercase mb-2">Expected Cash</div>
          <div className="space-y-1 text-[12px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">R1 Safe Drop</span>
              <span className="text-[var(--text-primary)] font-mono font-semibold">{fmt(expectedBreakdown.r1)}</span>
            </div>
            {(modalStore?.has_register2 && expectedBreakdown.r2 > 0) && (
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">R2 Safe Drop</span>
                <span className="text-[var(--text-primary)] font-mono font-semibold">{fmt(expectedBreakdown.r2)}</span>
              </div>
            )}
            <div className="border-t border-[var(--border-subtle)] pt-1 mt-1 flex justify-between">
              <span className="text-[var(--text-primary)] font-bold">Total Expected</span>
              <span className="text-[var(--text-primary)] font-mono font-extrabold text-[14px]">{fmt(expectedBreakdown.total)}</span>
            </div>
          </div>
        </div>
      )}

      <Field label="Cash Collected">
        <input
          type="number"
          value={form.cash_collected}
          onChange={e => setForm({...form, cash_collected: e.target.value})}
          className="!text-lg !py-3 !font-mono !font-bold"
        />
      </Field>

      {/* Live short/over indicator */}
      {modalDiff !== null && (
        <div className={`rounded-lg p-2.5 mb-3 border text-[12px] font-bold font-mono text-center ${
          Math.abs(modalDiff) < 0.01 ? 'bg-sw-blueD text-[var(--color-info)] border-sw-blue/30'
          : modalDiff > 0 ? 'bg-sw-greenD text-[var(--color-success)] border-sw-green/30'
          : 'bg-sw-redD text-[var(--color-danger)] border-sw-red/30'
        }`}>
          {Math.abs(modalDiff) < 0.01 ? '✓ MATCHED' : modalDiff > 0 ? `OVER +${fmt(modalDiff)}` : `SHORT ${fmt(modalDiff)}`}
        </div>
      )}

      <Field label="Note"><input type="text" value={form.note} onChange={e => setForm({...form, note: e.target.value})} /></Field>
      <div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => { setModal(null); setEditRow(null); }}>Cancel</Button><Button onClick={handleSave}>Save</Button></div>
    </Modal>}

  </div>);
}
