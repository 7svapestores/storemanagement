'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, Loading, Button } from '@/components/UI';
import { V2StatCard, Card } from '@/components/ui';
import { fmt, fK, dayLabel, downloadCSV } from '@/lib/utils';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const soColor = (v) => Math.abs(v) < 0.01 ? '#64748B' : v > 0 ? '#34D399' : '#F87171';

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
          .select('*, daily_sales(net_sales, r1_short_over, short_over)')
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

  // Deduplicate S/O per daily_sales_id — attribute to last closer
  const enriched = useMemo(() => {
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
      _so: primaryIds.has(s.id) ? Number(s.daily_sales?.r1_short_over ?? s.daily_sales?.short_over ?? 0) : 0,
      _sales: primaryIds.has(s.id) ? Number(s.daily_sales?.net_sales ?? 0) : 0,
      _isPrimary: primaryIds.has(s.id),
    }));
  }, [shifts]);

  const stats = useMemo(() => {
    const withHours = enriched.filter(s => Number(s.total_hours) > 0);
    const totalHours = withHours.reduce((s, r) => s + Number(r.total_hours), 0);
    const totalSales = enriched.reduce((s, r) => s + r._sales, 0);
    const totalSO = enriched.reduce((s, r) => s + r._so, 0);
    const avgShift = withHours.length ? (totalHours / withHours.length).toFixed(1) : '0';
    const longest = withHours.length ? withHours.reduce((a, b) => (Number(b.total_hours) > Number(a.total_hours) ? b : a)) : null;

    const dateSet = new Set(enriched.map(s => s.shift_date));
    const sortedDates = [...dateSet].sort();
    let maxConsec = 0, curConsec = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) { curConsec = 1; } else {
        const prev = new Date(sortedDates[i - 1] + 'T12:00:00');
        const cur = new Date(sortedDates[i] + 'T12:00:00');
        curConsec = (cur - prev === 86400000) ? curConsec + 1 : 1;
      }
      maxConsec = Math.max(maxConsec, curConsec);
    }

    return {
      totalShifts: enriched.length,
      totalHours: totalHours.toFixed(1),
      totalSales: totalSales.toFixed(2),
      totalSO: totalSO.toFixed(2),
      avgShift,
      longest: longest ? { hours: Number(longest.total_hours).toFixed(1), date: longest.shift_date } : null,
      maxConsec,
    };
  }, [enriched]);

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const exportCSV = () => {
    downloadCSV(`shifts-${employeeName}.csv`, ['Date', 'Day', 'Opened', 'Closed', 'Hours', 'Sales', 'Short/Over'],
      enriched.map(r => {
        const dow = DOW[new Date(r.shift_date + 'T12:00:00').getDay()];
        return [r.shift_date, dow, fmtTime(r.opened_at), fmtTime(r.closed_at), r.total_hours || '', r._sales || '', r._so || ''];
      }));
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] mb-3 flex-wrap">
        <button onClick={() => router.push('/employee-tracking')} className="text-[var(--color-info)] hover:underline">Employee Tracking</button>
        <span className="text-[var(--text-muted)]">/</span>
        <span className="text-[var(--text-secondary)] flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: store?.color || '#64748B' }} />
          {store?.name || '—'}
        </span>
        <span className="text-[var(--text-muted)]">/</span>
        <span className="text-[var(--text-primary)] font-semibold">{employeeName}</span>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-[var(--text-primary)] text-[20px] font-extrabold">{employeeName}</h1>
          <div className="text-[var(--text-secondary)] text-[12px] flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: store?.color || '#64748B' }} />
            {store?.name || '—'}
            {employeeName === 'User1' && <span className="text-[var(--text-muted)] ml-2">· Generic POS login — set up individual accounts in NRS</span>}
          </div>
        </div>
        <Button variant="secondary" onClick={exportCSV} className="!text-[11px]">CSV</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <V2StatCard label="Shifts" value={stats.totalShifts} icon="📋" variant="info" />
        <V2StatCard label="Hours" value={`${stats.totalHours}h`} icon="🕐" variant={Number(stats.totalHours) >= 40 ? 'success' : 'default'} />
        <V2StatCard label="Sales Handled" value={fK(Number(stats.totalSales))} icon="💵" variant="success" />
        <V2StatCard label="Net Short/Over" value={`${Number(stats.totalSO) >= 0 ? '+' : ''}${fmt(Number(stats.totalSO))}`} icon="💰" variant={Number(stats.totalSO) < 0 ? 'danger' : 'success'} />
        <V2StatCard label="Longest Shift" value={stats.longest ? `${stats.longest.hours}h` : '—'} sub={stats.longest ? dayLabel(stats.longest.date) : ''} icon="🏆" />
      </div>

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden mb-4">
        <DataTable
          sortState={sortState}
          onSortChange={setSortState}
          emptyMessage="No shifts in this date range."
          columns={[
            { key: 'shift_date', label: 'Date', render: v => dayLabel(v) },
            { key: '_dow', label: 'Day', sortable: true, sortValue: r => new Date(r.shift_date + 'T12:00:00').getDay(),
              render: (_, r) => <span className="text-[var(--text-secondary)] text-[11px]">{DOW[new Date(r.shift_date + 'T12:00:00').getDay()]}</span> },
            { key: 'opened_at', label: 'Opened', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'closed_at', label: 'Closed', render: v => <span className="font-mono text-[11px]">{fmtTime(v)}</span> },
            { key: 'total_hours', label: 'Hours', align: 'right', mono: true, sortValue: r => Number(r.total_hours || 0),
              render: v => v ? <span className={`font-bold ${v >= 8 ? 'text-[var(--color-success)]' : v >= 4 ? 'text-[var(--color-info)]' : 'text-[var(--color-warning)]'}`}>{Number(v).toFixed(1)}h</span> : <span className="text-[var(--text-muted)]">—</span> },
            { key: '_sales', label: 'Sales', align: 'right', mono: true, sortValue: r => r._sales,
              render: (_, r) => r._sales > 0 ? <span className="text-[var(--text-primary)]">{fmt(r._sales)}</span> : <span className="text-[var(--text-muted)]">—</span> },
            { key: '_so', label: 'S/O', align: 'right', mono: true, sortable: true, sortValue: r => r._so,
              render: (_, r) => {
                if (!r._isPrimary) return <span className="text-[var(--text-muted)]">—</span>;
                const v = r._so;
                if (Math.abs(v) < 0.01) return <span className="text-[var(--text-muted)]">⚪ $0</span>;
                return <span style={{ color: soColor(v) }} className="font-bold">{v > 0 ? '🟢 +' : '🔴 '}{fmt(v)}</span>;
              } },
          ]}
          rows={enriched}
          isOwner={false}
        />
        {enriched.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex justify-between items-center flex-wrap gap-2 text-[11px]">
            <span className="text-[var(--text-secondary)] font-bold uppercase">{enriched.length} shifts · {stats.maxConsec} max consecutive days</span>
            <span className="font-mono font-bold" style={{ color: soColor(Number(stats.totalSO)) }}>
              Net S/O: {Number(stats.totalSO) >= 0 ? '+' : ''}{fmt(Number(stats.totalSO))}
            </span>
          </div>
        )}
      </div>

      {/* Payroll Impact */}
      {enriched.length > 0 && (
        <Card padding="md">
          <div className="text-[var(--text-primary)] text-[13px] font-bold mb-2">💰 Payroll Impact</div>
          <div className="grid grid-cols-2 gap-y-1.5 text-[12px] max-w-sm">
            <div className="text-[var(--text-secondary)]">Date Range</div>
            <div className="text-right text-[var(--text-primary)]">{range.start} — {range.end}</div>
            <div className="text-[var(--text-secondary)]">Total Hours Worked</div>
            <div className="text-right text-[var(--text-primary)] font-mono font-bold">{stats.totalHours}h</div>
            <div className="text-[var(--text-secondary)]">Sales Handled</div>
            <div className="text-right text-[var(--text-primary)] font-mono">{fmt(Number(stats.totalSales))}</div>
            <div className="text-[var(--text-secondary)] font-semibold">Cumulative Short/Over</div>
            <div className="text-right font-mono font-bold" style={{ color: soColor(Number(stats.totalSO)) }}>
              {Number(stats.totalSO) >= 0 ? '+' : ''}{fmt(Number(stats.totalSO))}
            </div>
          </div>
          <div className="text-[var(--text-muted)] text-[10px] mt-3 space-y-0.5">
            <div>If negative: deduct from paycheck</div>
            <div>If positive: employee overage — goes to store</div>
          </div>
        </Card>
      )}
    </div>
  );
}
