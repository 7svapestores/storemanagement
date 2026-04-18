'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, StatCard, Loading, Button } from '@/components/UI';
import { dayLabel, downloadCSV } from '@/lib/utils';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thismonth');
  const [shifts, setShifts] = useState([]);
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortState, setSortState] = useState({ key: 'shift_date', dir: 'desc' });

  const storeId = params.storeId;
  const employeeName = decodeURIComponent(params.employeeName || '');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: st }, { data: sh }] = await Promise.all([
        supabase.from('stores').select('id, name, color').eq('id', storeId).single(),
        supabase.from('employee_shifts')
          .select('*')
          .eq('store_id', storeId)
          .eq('employee_name', employeeName)
          .gte('shift_date', range.start)
          .lte('shift_date', range.end)
          .order('shift_date', { ascending: false }),
      ]);
      setStore(st);
      setShifts(sh || []);
      setLoading(false);
    })();
  }, [range.start, range.end, storeId, employeeName]);

  const stats = useMemo(() => {
    const withHours = shifts.filter(s => Number(s.total_hours) > 0);
    const totalHours = withHours.reduce((s, r) => s + Number(r.total_hours), 0);
    const avgShift = withHours.length ? (totalHours / withHours.length).toFixed(1) : '0';
    const longest = withHours.length ? withHours.reduce((a, b) => (Number(b.total_hours) > Number(a.total_hours) ? b : a)) : null;
    const shortest = withHours.length ? withHours.reduce((a, b) => (Number(b.total_hours) < Number(a.total_hours) ? b : a)) : null;

    // Consecutive days
    const dateSet = new Set(shifts.map(s => s.shift_date));
    const sortedDates = [...dateSet].sort();
    let maxConsec = 0, curConsec = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) { curConsec = 1; }
      else {
        const prev = new Date(sortedDates[i - 1] + 'T12:00:00');
        const cur = new Date(sortedDates[i] + 'T12:00:00');
        curConsec = (cur - prev === 86400000) ? curConsec + 1 : 1;
      }
      maxConsec = Math.max(maxConsec, curConsec);
    }

    // Days off
    let daysOff = 0;
    if (sortedDates.length >= 2) {
      const first = new Date(sortedDates[0] + 'T12:00:00');
      const last = new Date(sortedDates[sortedDates.length - 1] + 'T12:00:00');
      const totalDays = Math.round((last - first) / 86400000) + 1;
      daysOff = totalDays - dateSet.size;
    }

    return {
      totalShifts: shifts.length,
      totalHours: totalHours.toFixed(1),
      avgShift,
      longest: longest ? { hours: Number(longest.total_hours).toFixed(1), date: longest.shift_date } : null,
      shortest: shortest ? { hours: Number(shortest.total_hours).toFixed(1), date: shortest.shift_date } : null,
      maxConsec,
      daysOff,
    };
  }, [shifts]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const exportCSV = () => {
    downloadCSV(`shifts-${employeeName}.csv`, ['Date', 'Day', 'Opened', 'Closed', 'Hours'],
      shifts.map(r => {
        const dow = DOW[new Date(r.shift_date + 'T12:00:00').getDay()];
        return [r.shift_date, dow, fmtTime(r.opened_at), fmtTime(r.closed_at), r.total_hours || ''];
      }));
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] mb-3 flex-wrap">
        <button onClick={() => router.push('/employee-tracking')} className="text-sw-blue hover:underline">Employee Tracking</button>
        <span className="text-sw-dim">/</span>
        <span className="text-sw-sub flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: store?.color || '#64748B' }} />
          {store?.name || '—'}
        </span>
        <span className="text-sw-dim">/</span>
        <span className="text-sw-text font-semibold">{employeeName}</span>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-sw-text text-[20px] font-extrabold">{employeeName}</h1>
          <div className="text-sw-sub text-[12px] flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: store?.color || '#64748B' }} />
            {store?.name || '—'}
            {employeeName === 'User1' && <span className="text-sw-dim ml-2">· Generic POS login — set up individual accounts in NRS</span>}
          </div>
        </div>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">CSV</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5">
        <StatCard label="Total Shifts" value={stats.totalShifts} icon="📋" color="#60A5FA" />
        <StatCard label="Total Hours" value={`${stats.totalHours}h`} icon="🕐" color={Number(stats.totalHours) >= 40 ? '#34D399' : '#60A5FA'} />
        <StatCard label="Avg / Shift" value={`${stats.avgShift}h`} icon="📊" color="#FBBF24" />
        <StatCard label="Longest Shift" value={stats.longest ? `${stats.longest.hours}h` : '—'} sub={stats.longest ? dayLabel(stats.longest.date) : ''} icon="🏆" color="#C084FC" />
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable
          sortState={sortState}
          onSortChange={setSortState}
          emptyMessage="No shifts in this date range."
          columns={[
            { key: 'shift_date', label: 'Date', render: v => dayLabel(v) },
            { key: '_dow', label: 'Day', sortValue: r => new Date(r.shift_date + 'T12:00:00').getDay(),
              render: (_, r) => <span className="text-sw-sub text-[11px]">{DOW[new Date(r.shift_date + 'T12:00:00').getDay()]}</span> },
            { key: 'opened_at', label: 'Opened', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'closed_at', label: 'Closed', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'total_hours', label: 'Hours', align: 'right', mono: true, sortValue: r => Number(r.total_hours || 0),
              render: v => v ? <span className={`font-bold ${v >= 8 ? 'text-sw-green' : v >= 4 ? 'text-sw-blue' : 'text-sw-amber'}`}>{Number(v).toFixed(1)}h</span> : <span className="text-sw-dim">—</span>
            },
          ]}
          rows={shifts}
          isOwner={false}
        />
        {shifts.length > 0 && (
          <div className="px-3 py-2 border-t border-sw-border bg-sw-card2">
            <div className="flex justify-between items-center flex-wrap gap-2 text-[11px]">
              <span className="text-sw-sub font-bold uppercase">{shifts.length} shifts</span>
              <div className="flex gap-4 text-sw-sub">
                {stats.shortest && <span>Shortest: <span className="text-sw-text font-mono">{stats.shortest.hours}h</span> ({dayLabel(stats.shortest.date)})</span>}
                <span>Consecutive: <span className="text-sw-text font-semibold">{stats.maxConsec} days</span></span>
                <span>Days off: <span className="text-sw-text font-semibold">{stats.daysOff}</span></span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
