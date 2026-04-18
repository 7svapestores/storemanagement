'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, PageHeader, StatCard, Loading, Button } from '@/components/UI';
import { fmt, dayLabel, downloadCSV } from '@/lib/utils';

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
          .select('*, stores(name, color), daily_sales(net_sales, r1_short_over, short_over)')
          .gte('shift_date', range.start)
          .lte('shift_date', range.end)
          .order('opened_at', { ascending: true }),
      ]);
      setStores(st || []);
      setShifts(sh || []);
      setLoading(false);
    })();
  }, [range.start, range.end]);

  // Deduplicate short_over per daily_sales_id: attribute to the LAST closer
  const shiftsWithSO = useMemo(() => {
    const dsMap = {};
    shifts.forEach(s => {
      if (!s.daily_sales_id) return;
      const prev = dsMap[s.daily_sales_id];
      if (!prev || (s.closed_at && (!prev.closed_at || s.closed_at > prev.closed_at))) {
        dsMap[s.daily_sales_id] = s;
      }
    });
    const primaryIds = new Set(Object.values(dsMap).map(s => s.id));
    return shifts.map(s => ({
      ...s,
      _isPrimary: primaryIds.has(s.id),
      _so: primaryIds.has(s.id) ? (Number(s.daily_sales?.r1_short_over ?? s.daily_sales?.short_over ?? 0)) : 0,
      _sales: primaryIds.has(s.id) ? (Number(s.daily_sales?.net_sales ?? 0)) : 0,
    }));
  }, [shifts]);

  const grouped = useMemo(() => {
    const storeMap = {};
    for (const s of shiftsWithSO) {
      const sid = s.store_id;
      if (!storeMap[sid]) storeMap[sid] = { store: s.stores || {}, employees: {} };
      const eName = s.employee_name || 'Unknown';
      if (!storeMap[sid].employees[eName]) storeMap[sid].employees[eName] = { shifts: [], totalHours: 0, totalSO: 0, totalSales: 0 };
      const b = storeMap[sid].employees[eName];
      b.shifts.push(s);
      b.totalHours += Number(s.total_hours) || 0;
      b.totalSO += s._so;
      b.totalSales += s._sales;
    }
    return Object.entries(storeMap).map(([sid, { store, employees }]) => ({
      storeId: sid, storeName: store.name || '—', storeColor: store.color,
      employees: Object.entries(employees).map(([name, d]) => ({
        name,
        shiftCount: d.shifts.length,
        totalHours: parseFloat(d.totalHours.toFixed(1)),
        avgHours: d.shifts.length ? parseFloat((d.totalHours / d.shifts.length).toFixed(1)) : 0,
        totalSO: parseFloat(d.totalSO.toFixed(2)),
        totalSales: parseFloat(d.totalSales.toFixed(2)),
      })).sort((a, b) => b.totalHours - a.totalHours),
      totalShifts: Object.values(employees).reduce((s, e) => s + e.shifts.length, 0),
      totalHours: parseFloat(Object.values(employees).reduce((s, e) => s + e.totalHours, 0).toFixed(1)),
      totalSO: parseFloat(Object.values(employees).reduce((s, e) => s + e.totalSO, 0).toFixed(2)),
      employeeCount: Object.keys(employees).length,
    }));
  }, [shiftsWithSO]);

  const totals = useMemo(() => {
    const h = shiftsWithSO.reduce((s, r) => s + (Number(r.total_hours) || 0), 0);
    const so = shiftsWithSO.reduce((s, r) => s + r._so, 0);
    const emps = new Set(shiftsWithSO.map(r => r.employee_name)).size;
    return { shifts: shiftsWithSO.length, hours: h.toFixed(1), employees: emps, so: so.toFixed(2) };
  }, [shiftsWithSO]);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const exportCSV = () => {
    const rows = [];
    grouped.forEach(g => g.employees.forEach(e => {
      rows.push([g.storeName, e.name, e.shiftCount, e.totalHours, e.avgHours, e.totalSales, e.totalSO]);
    }));
    downloadCSV('employee-summary.csv', ['Store', 'Employee', 'Shifts', 'Hours', 'Avg Hrs', 'Sales', 'Short/Over'], rows);
  };

  const goDetail = (storeId, name) => router.push(`/employee-tracking/${storeId}/${encodeURIComponent(name)}`);
  const soColor = (v) => Math.abs(v) < 0.01 ? '#64748B' : v > 0 ? '#34D399' : '#F87171';

  return (
    <div>
      <PageHeader title="Employee Tracking" subtitle={`${totals.shifts} shifts · ${totals.hours}h · ${totals.employees} employees`}>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5">
        <StatCard label="Total Shifts" value={totals.shifts} icon="📋" color="#60A5FA" />
        <StatCard label="Total Hours" value={`${totals.hours}h`} icon="🕐" color="#34D399" />
        <StatCard label="Employees" value={totals.employees} icon="👤" color="#C084FC" />
        <StatCard label="Net Short/Over" value={`${Number(totals.so) >= 0 ? '+' : ''}${fmt(Number(totals.so))}`} icon="💰" color={soColor(Number(totals.so))} />
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      {shifts.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">
          No shifts recorded yet. Run the backfill or wait for tomorrow's 7S Agent sync.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => (
            <div key={g.storeId} className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
              <div className="px-4 py-3 bg-sw-card2 border-b border-sw-border flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded" style={{ background: g.storeColor || '#64748B' }} />
                  <span className="text-sw-text text-[14px] font-bold">{g.storeName}</span>
                </div>
                <div className="text-sw-sub text-[11px] flex gap-3">
                  <span>{g.totalShifts} shifts</span>
                  <span>{g.totalHours}h</span>
                  <span>{g.employeeCount} emp</span>
                  <span style={{ color: soColor(g.totalSO) }} className="font-mono font-bold">
                    S/O: {g.totalSO >= 0 ? '+' : ''}{fmt(g.totalSO)}
                  </span>
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
                      {emp.name === 'User1' && <span className="text-sw-dim text-[9px]">Generic</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px] mb-3">
                      <div className="text-sw-sub">Shifts</div>
                      <div className="text-right text-sw-text font-semibold">{emp.shiftCount}</div>
                      <div className="text-sw-sub">Hours</div>
                      <div className="text-right font-mono font-bold" style={{ color: emp.totalHours >= 40 ? '#34D399' : '#60A5FA' }}>{emp.totalHours}h</div>
                      <div className="text-sw-sub">Avg / Shift</div>
                      <div className="text-right font-mono text-sw-text">{emp.avgHours}h</div>
                      <div className="text-sw-sub">Sales Handled</div>
                      <div className="text-right font-mono text-sw-text">{fmt(emp.totalSales)}</div>
                      <div className="text-sw-sub font-semibold">Short/Over</div>
                      <div className="text-right font-mono font-bold" style={{ color: soColor(emp.totalSO) }}>
                        {emp.totalSO >= 0 ? '+' : ''}{fmt(emp.totalSO)}
                      </div>
                    </div>
                    <div className="text-sw-blue text-[11px] font-semibold group-hover:underline">View Details →</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
