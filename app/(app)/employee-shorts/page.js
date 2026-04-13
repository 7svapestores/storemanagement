'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, StatCard, Loading, StoreBadge, Alert, Button } from '@/components/UI';
import { fmt, dayLabel, downloadCSV } from '@/lib/utils';

export default function EmployeeShortsPage() {
  const { supabase, isOwner, profile } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState([]);
  const [stores, setStores] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending'); // 'all' | 'pending' | 'deducted'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: st } = await supabase.from('stores').select('id, name, color').order('name');
      setStores(st || []);

      const { data: emps } = await supabase
        .from('profiles').select('id, name').eq('role', 'employee').order('name');
      setEmployees(emps || []);

      let q = supabase
        .from('employee_shortover')
        .select('*, stores(name, color)')
        .gte('date', range.start).lte('date', range.end)
        .order('date', { ascending: false });
      if (storeFilter) q = q.eq('store_id', storeFilter);
      if (employeeFilter) q = q.eq('employee_id', employeeFilter);
      if (statusFilter === 'pending') q = q.eq('deducted', false);
      if (statusFilter === 'deducted') q = q.eq('deducted', true);

      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('[employee-shorts] load failed:', e);
      setLoadError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range.start, range.end, storeFilter, employeeFilter, statusFilter]);

  const totals = useMemo(() => {
    const all = rows.reduce((s, r) => s + Number(r.total_short || 0), 0);
    const pending = rows.filter(r => !r.deducted).reduce((s, r) => s + Number(r.total_short || 0), 0);
    const done = rows.filter(r => r.deducted).reduce((s, r) => s + Number(r.total_short || 0), 0);
    return { all, pending, done };
  }, [rows]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.id)));
  };

  const markDeducted = async () => {
    if (!selectedIds.size) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('employee_shortover')
        .update({ deducted: true, deducted_at: new Date().toISOString(), deducted_by: profile?.id })
        .in('id', Array.from(selectedIds));
      if (error) throw error;
      load();
    } catch (e) {
      alert(`Mark deducted failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const undoDeducted = async (id) => {
    const { error } = await supabase
      .from('employee_shortover')
      .update({ deducted: false, deducted_at: null, deducted_by: null })
      .eq('id', id);
    if (error) alert(error.message);
    load();
  };

  const exportCSV = () => {
    downloadCSV(
      `employee-shorts-${range.start}-${range.end}.csv`,
      ['Date', 'Employee', 'Store', 'R1 Short/Over', 'R2 Short/Over', 'Total', 'Deducted', 'Notes'],
      rows.map(r => [
        r.date, r.employee_name || '', r.stores?.name || '',
        r.r1_short, r.r2_short, r.total_short,
        r.deducted ? 'yes' : 'no',
        r.notes || '',
      ]),
    );
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="💸 Employee Shorts" subtitle={`${rows.length} records · ${range.start} to ${range.end}`}>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">📥 CSV</Button>
      </PageHeader>

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {/* Filters */}
      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className="!w-auto !min-w-[160px] !py-1.5 !text-[11px]">
          <option value="">All employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="!w-auto !min-w-[180px] !py-1.5 !text-[11px]">
          <option value="">All stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="!w-auto !min-w-[140px] !py-1.5 !text-[11px]">
          <option value="pending">Not yet deducted</option>
          <option value="deducted">Already deducted</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 mb-3.5">
        <StatCard
          label="Pending deduction"
          value={fmt(totals.pending)}
          icon="⏳"
          color={totals.pending < 0 ? '#F87171' : '#FBBF24'}
          sub={`${rows.filter(r => !r.deducted).length} records`}
        />
        <StatCard
          label="Already deducted"
          value={fmt(totals.done)}
          icon="✅"
          color="#34D399"
          sub={`${rows.filter(r => r.deducted).length} records`}
        />
        <StatCard
          label="Net total (period)"
          value={fmt(totals.all)}
          icon={totals.all < 0 ? '🔴' : totals.all > 0 ? '🟢' : '➖'}
          color={totals.all === 0 ? '#64748B' : totals.all < 0 ? '#F87171' : '#34D399'}
        />
      </div>

      {/* Action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-sw-blueD border border-sw-blue/30 rounded-lg p-2.5 mb-3 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sw-blue text-[12px] font-semibold">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button onClick={markDeducted} disabled={busy}>
              {busy ? 'Saving…' : '✓ Mark as Deducted'}
            </Button>
          </div>
        </div>
      )}

      {/* Table — custom layout to add checkbox column */}
      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sw-dim">
            No records for this filter. Owner short/over entries on Daily Sales create these rows automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === rows.length}
                      onChange={toggleSelectAll}
                      className="!min-h-0 !w-4 !h-4"
                    />
                  </th>
                  <th>Date</th>
                  <th>Employee</th>
                  <th className="hidden md:table-cell">Store</th>
                  <th className="hidden md:table-cell" style={{ textAlign: 'right' }}>R1</th>
                  <th className="hidden md:table-cell" style={{ textAlign: 'right' }}>R2</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        disabled={r.deducted}
                        className="!min-h-0 !w-4 !h-4"
                      />
                    </td>
                    <td>{dayLabel(r.date)}</td>
                    <td className="font-semibold">{r.employee_name || '—'}</td>
                    <td className="hidden md:table-cell"><StoreBadge name={r.stores?.name} color={r.stores?.color} /></td>
                    <td className="hidden md:table-cell" style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {Number(r.r1_short) === 0 ? <span className="text-sw-dim">—</span> : <span className={r.r1_short < 0 ? 'text-sw-red' : 'text-sw-green'}>{fmt(r.r1_short)}</span>}
                    </td>
                    <td className="hidden md:table-cell" style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {Number(r.r2_short) === 0 ? <span className="text-sw-dim">—</span> : <span className={r.r2_short < 0 ? 'text-sw-red' : 'text-sw-green'}>{fmt(r.r2_short)}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span className={r.total_short < 0 ? 'text-sw-red font-bold' : r.total_short > 0 ? 'text-sw-green font-bold' : 'text-sw-dim'}>
                        {Number(r.total_short) >= 0 ? '+' : ''}{fmt(r.total_short)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.deducted ? (
                        <button
                          onClick={() => undoDeducted(r.id)}
                          title="Click to un-mark"
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sw-greenD text-sw-green"
                        >
                          ✓ DEDUCTED
                        </button>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sw-amberD text-sw-amber">
                          PENDING
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
