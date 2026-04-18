'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, StatCard, Loading, StoreBadge, Button, MultiSelect, SortDropdown } from '@/components/UI';
import { fmt, dayLabel, downloadCSV } from '@/lib/utils';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
}

export default function EmployeeTrackingPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thisweek');
  const [shifts, setShifts] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState([]);
  const [search, setSearch] = useState('');
  const [sortState, setSortState] = useState({ key: 'shift_date', dir: 'desc' });

  const sortOptions = [
    { label: 'Date (newest)', key: 'shift_date', dir: 'desc' },
    { label: 'Date (oldest)', key: 'shift_date', dir: 'asc' },
    { label: 'Employee A-Z', key: 'employee_name', dir: 'asc' },
    { label: 'Hours (most)', key: 'total_hours', dir: 'desc' },
    { label: 'Hours (least)', key: 'total_hours', dir: 'asc' },
    { label: 'Store A-Z', key: '_store', dir: 'asc' },
  ];

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: st }, { data: sh }] = await Promise.all([
        supabase.from('stores').select('id, name, color').order('name'),
        supabase.from('employee_shifts')
          .select('*, stores(name, color)')
          .gte('shift_date', range.start)
          .lte('shift_date', range.end)
          .order('shift_date', { ascending: false }),
      ]);
      setStores(st || []);
      setShifts(sh || []);
      setLoading(false);
    })();
  }, [range.start, range.end]);

  const employeeOptions = useMemo(
    () => [...new Set(shifts.map(s => s.employee_name))].sort().map(n => ({ value: n, label: n })),
    [shifts]
  );

  const filtered = useMemo(() => shifts.filter(s => {
    if (storeFilter.length && !storeFilter.includes(s.store_id)) return false;
    if (employeeFilter.length && !employeeFilter.includes(s.employee_name)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(s.employee_name || '').toLowerCase().includes(q) && !(s.stores?.name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [shifts, storeFilter, employeeFilter, search]);

  const stats = useMemo(() => {
    const totalHours = filtered.reduce((s, r) => s + (Number(r.total_hours) || 0), 0);
    const uniqueEmployees = new Set(filtered.map(r => r.employee_name)).size;
    const withHours = filtered.filter(r => Number(r.total_hours) > 0);
    const avgShift = withHours.length ? (withHours.reduce((s, r) => s + Number(r.total_hours), 0) / withHours.length).toFixed(1) : '0';
    return { totalHours: totalHours.toFixed(1), uniqueEmployees, avgShift };
  }, [filtered]);

  // All hooks are above — safe to do early returns now
  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const exportCSV = () => {
    downloadCSV('employee-shifts.csv', ['Date', 'Employee', 'Store', 'Opened', 'Closed', 'Hours'],
      filtered.map(r => [r.shift_date, r.employee_name, r.stores?.name || '', fmtTime(r.opened_at), fmtTime(r.closed_at), r.total_hours || '']));
  };

  return (
    <div>
      <PageHeader title="Employee Tracking" subtitle={`${filtered.length} shifts`}>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 mb-3.5">
        <StatCard label="Total Hours" value={`${stats.totalHours}h`} icon="🕐" color="#60A5FA" />
        <StatCard label="Active Employees" value={stats.uniqueEmployees} icon="👤" color="#34D399" />
        <StatCard label="Avg Shift" value={`${stats.avgShift}h`} icon="📊" color="#FBBF24" />
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <MultiSelect label="Store" placeholder="All Stores" unitLabel="store" value={storeFilter} onChange={setStoreFilter} options={stores.map(s => ({ value: s.id, label: s.name }))} />
        <MultiSelect label="Employee" placeholder="All Employees" unitLabel="employee" value={employeeFilter} onChange={setEmployeeFilter} options={employeeOptions} />
        <SortDropdown options={sortOptions} value={sortState} onChange={setSortState} />
        <input type="text" placeholder="Search… (name, store)" value={search} onChange={e => setSearch(e.target.value)} className="!w-full sm:!flex-1 sm:!min-w-[200px] !py-1.5 !text-[11px]" />
        {(storeFilter.length > 0 || employeeFilter.length > 0 || search) && (
          <button onClick={() => { setStoreFilter([]); setEmployeeFilter([]); setSearch(''); }} className="text-sw-dim text-[10px] underline">clear</button>
        )}
      </div>

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable
          sortState={sortState}
          onSortChange={setSortState}
          emptyMessage="No shifts recorded yet. Run the backfill or wait for tomorrow's 7S Agent sync."
          columns={[
            { key: 'shift_date', label: 'Date', render: v => dayLabel(v) },
            { key: 'employee_name', label: 'Employee', render: v => <span className="text-sw-text font-semibold">{v}</span> },
            { key: '_store', label: 'Store', sortValue: r => r.stores?.name || '', render: (_, r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
            { key: 'opened_at', label: 'Opened', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'closed_at', label: 'Closed', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'total_hours', label: 'Hours', align: 'right', mono: true, sortValue: r => Number(r.total_hours || 0),
              render: v => v ? <span className={`font-bold ${v >= 8 ? 'text-sw-green' : v >= 4 ? 'text-sw-blue' : 'text-sw-amber'}`}>{Number(v).toFixed(1)}h</span> : <span className="text-sw-dim">—</span>
            },
          ]}
          rows={filtered}
          isOwner={false}
        />
        {filtered.length > 0 && (
          <div className="px-3 py-2 border-t border-sw-border bg-sw-card2 flex justify-between items-center">
            <span className="text-sw-sub text-[11px] font-bold uppercase">{filtered.length} shifts</span>
            <span className="text-sw-blue text-[13px] font-mono font-bold">{stats.totalHours}h total</span>
          </div>
        )}
      </div>
    </div>
  );
}
