'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, PageHeader, StatCard, Loading, Button } from '@/components/UI';
import { fmt, dayLabel, downloadCSV } from '@/lib/utils';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
}

export default function EmployeeTrackingPage() {
  const router = useRouter();
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thisweek');
  const [shifts, setShifts] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: st }, { data: sh }] = await Promise.all([
        supabase.from('stores').select('id, name, color').order('created_at'),
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

  // Group by store → employee with aggregates
  const grouped = useMemo(() => {
    const storeMap = {};
    for (const s of shifts) {
      const sid = s.store_id;
      if (!storeMap[sid]) storeMap[sid] = { store: s.stores || {}, employees: {} };
      const eName = s.employee_name || 'Unknown';
      if (!storeMap[sid].employees[eName]) storeMap[sid].employees[eName] = { shifts: [], totalHours: 0 };
      const bucket = storeMap[sid].employees[eName];
      bucket.shifts.push(s);
      bucket.totalHours += Number(s.total_hours) || 0;
    }
    return Object.entries(storeMap).map(([sid, { store, employees }]) => ({
      storeId: sid,
      storeName: store.name || '—',
      storeColor: store.color,
      employees: Object.entries(employees).map(([name, data]) => ({
        name,
        shiftCount: data.shifts.length,
        totalHours: parseFloat(data.totalHours.toFixed(1)),
        avgHours: data.shifts.length ? parseFloat((data.totalHours / data.shifts.length).toFixed(1)) : 0,
        firstDate: data.shifts[data.shifts.length - 1]?.shift_date || '',
        lastDate: data.shifts[0]?.shift_date || '',
      })).sort((a, b) => b.totalHours - a.totalHours),
      totalShifts: Object.values(employees).reduce((s, e) => s + e.shifts.length, 0),
      totalHours: parseFloat(Object.values(employees).reduce((s, e) => s + e.totalHours, 0).toFixed(1)),
      employeeCount: Object.keys(employees).length,
    }));
  }, [shifts]);

  const totals = useMemo(() => {
    const totalHours = shifts.reduce((s, r) => s + (Number(r.total_hours) || 0), 0);
    const uniqueEmployees = new Set(shifts.map(r => r.employee_name)).size;
    const withHours = shifts.filter(r => Number(r.total_hours) > 0);
    const avgShift = withHours.length ? (withHours.reduce((s, r) => s + Number(r.total_hours), 0) / withHours.length).toFixed(1) : '0';
    return { totalHours: totalHours.toFixed(1), uniqueEmployees, avgShift, totalShifts: shifts.length };
  }, [shifts]);

  // Top 5 by hours
  const leaderboard = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const k = s.employee_name;
      if (!map[k]) map[k] = { name: k, hours: 0, storeName: s.stores?.name };
      map[k].hours += Number(s.total_hours) || 0;
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours).slice(0, 5);
  }, [shifts]);
  const maxHours = leaderboard[0]?.hours || 1;

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const exportCSV = () => {
    downloadCSV('employee-shifts.csv', ['Date', 'Employee', 'Store', 'Opened', 'Closed', 'Hours'],
      shifts.map(r => [r.shift_date, r.employee_name, r.stores?.name || '', fmtTime(r.opened_at), fmtTime(r.closed_at), r.total_hours || '']));
  };

  const goDetail = (storeId, name) => {
    router.push(`/employee-tracking/${storeId}/${encodeURIComponent(name)}`);
  };

  const hoursColor = (h) => h >= 40 ? '#34D399' : h >= 20 ? '#60A5FA' : '#FBBF24';

  return (
    <div>
      <PageHeader title="Employee Tracking" subtitle={`${totals.totalShifts} shifts · ${totals.totalHours}h`}>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5">
        <StatCard label="Total Shifts" value={totals.totalShifts} icon="📋" color="#60A5FA" />
        <StatCard label="Total Hours" value={`${totals.totalHours}h`} icon="🕐" color="#34D399" />
        <StatCard label="Employees" value={totals.uniqueEmployees} icon="👤" color="#C084FC" />
        <StatCard label="Avg Shift" value={`${totals.avgShift}h`} icon="📊" color="#FBBF24" />
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {shifts.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
          No shifts recorded yet. Run the backfill or wait for tomorrow's 7S Agent sync.
        </div>
      ) : (
        <>
          {/* Store groups */}
          <div className="space-y-4 mb-6">
            {grouped.map(g => (
              <div key={g.storeId} className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
                <div className="px-4 py-3 bg-sw-card2 border-b border-sw-border flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-3 h-3 rounded" style={{ background: g.storeColor || '#64748B' }} />
                    <span className="text-sw-text text-[14px] font-bold">{g.storeName}</span>
                  </div>
                  <div className="text-sw-sub text-[11px]">
                    {g.totalShifts} shifts · {g.totalHours}h · {g.employeeCount} employee{g.employeeCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.employees.map(emp => (
                    <button
                      key={emp.name}
                      onClick={() => goDetail(g.storeId, emp.name)}
                      className="bg-sw-card2 border border-sw-border rounded-lg p-4 text-left hover:border-sw-blue/40 transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sw-text text-[14px] font-bold group-hover:text-sw-blue transition-colors">{emp.name}</span>
                        {emp.name === 'User1' && <span className="text-sw-dim text-[9px]">Generic login</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-y-1.5 text-[11px] mb-3">
                        <div className="text-sw-sub">Shifts</div>
                        <div className="text-right text-sw-text font-semibold">{emp.shiftCount}</div>
                        <div className="text-sw-sub">Total Hours</div>
                        <div className="text-right font-mono font-bold" style={{ color: hoursColor(emp.totalHours) }}>{emp.totalHours}h</div>
                        <div className="text-sw-sub">Avg / Shift</div>
                        <div className="text-right font-mono text-sw-text">{emp.avgHours}h</div>
                        <div className="text-sw-sub">Period</div>
                        <div className="text-right text-sw-dim text-[10px]">{emp.firstDate} — {emp.lastDate}</div>
                      </div>
                      <div className="text-sw-blue text-[11px] font-semibold group-hover:underline">View Details →</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 1 && (
            <div className="bg-sw-card rounded-xl border border-sw-border p-4">
              <div className="text-sw-text text-[13px] font-bold mb-3">Top Employees by Hours</div>
              <div className="space-y-2">
                {leaderboard.map((e, i) => (
                  <div key={e.name} className="flex items-center gap-3">
                    <span className="text-sw-dim text-[11px] w-5 text-right font-bold">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sw-text text-[12px] font-semibold truncate">{e.name}</span>
                        <span className="text-sw-text text-[12px] font-mono font-bold">{e.hours.toFixed(1)}h</span>
                      </div>
                      <div className="w-full bg-sw-card2 rounded-full h-2">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(e.hours / maxHours) * 100}%`, background: i === 0 ? '#34D399' : i === 1 ? '#60A5FA' : '#FBBF24' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
