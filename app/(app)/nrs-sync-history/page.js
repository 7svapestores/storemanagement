'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Loading, DateBar, useDateRange, Alert } from '@/components/UI';
import { dayLabel } from '@/lib/utils';

const STATUS_STYLE = {
  success: 'bg-sw-greenD text-sw-green',
  failed: 'bg-sw-redD text-sw-red',
  skipped: 'bg-sw-amberD text-sw-amber',
  partial: 'bg-sw-amberD text-sw-amber',
  pending: 'bg-sw-card2 text-sw-dim',
};

export default function NRSSyncHistoryPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('thisweek');
  const [logs, setLogs] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data: st }, { data: lg }] = await Promise.all([
      supabase.from('stores').select('id, name').order('name'),
      supabase.from('nrs_sync_log')
        .select('*')
        .gte('sync_date', range.start)
        .lte('sync_date', range.end)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);
    setStores(st || []);
    setLogs(lg || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [range.start, range.end]);

  const storeName = (id) => stores.find(s => s.id === id)?.name || '—';

  const filtered = statusFilter ? logs.filter(l => l.status === statusFilter) : logs;

  const manualRun = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError('');
    try {
      const secret = prompt('Enter CRON_SECRET to authorize:');
      if (!secret) { setRunning(false); return; }
      const res = await fetch('/api/cron/nrs-sync', {
        headers: { 'Authorization': `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setRunResult(data);
      load();
    } catch (e) {
      setRunError(e.message);
    } finally {
      setRunning(false);
    }
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  // Group by date
  const byDate = {};
  filtered.forEach(l => {
    const key = l.sync_date;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(l);
  });
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <PageHeader title="NRS Sync History" subtitle={`${filtered.length} records`}>
        <Button variant="secondary" onClick={load} className="!text-[11px]">Refresh</Button>
        <Button onClick={manualRun} disabled={running}>
          {running ? 'Running…' : 'Run Sync Now'}
        </Button>
      </PageHeader>

      {runError && <Alert type="error">{runError}</Alert>}
      {runResult && (
        <Alert type="success">
          Sync complete: {runResult.created} created, {runResult.skipped} skipped, {runResult.failed} failed
        </Alert>
      )}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3 flex gap-2 flex-wrap items-center">
        <label className="text-sw-sub text-[10px] font-bold uppercase">Status</label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="!w-auto !min-w-[140px] !py-1.5 !text-[11px]">
          <option value="">All</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <span className="text-sw-dim text-[11px]">{filtered.length} entries</span>
      </div>

      {sortedDates.length === 0 ? (
        <div className="bg-sw-card border border-sw-border rounded-xl p-8 text-center text-sw-dim">No sync records for this period.</div>
      ) : (
        <div className="space-y-3">
          {sortedDates.map(date => (
            <div key={date} className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
              <div className="px-3 py-2 bg-sw-card2 border-b border-sw-border">
                <span className="text-sw-text text-[13px] font-bold">{dayLabel(date)}</span>
                <span className="text-sw-dim text-[11px] ml-2">{byDate[date].length} stores</span>
              </div>
              {byDate[date].map(l => (
                <div key={l.id} className="px-3 py-2 border-b border-sw-border last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${STATUS_STYLE[l.status] || ''}`}>
                        {l.status}
                      </span>
                      <span className="text-sw-text text-[12px] font-semibold truncate">{storeName(l.store_id)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sw-dim text-[10px]">{new Date(l.created_at).toLocaleTimeString()}</span>
                      {l.nrs_response && (
                        <button
                          onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                          className="text-sw-blue text-[10px] underline"
                        >
                          {expanded === l.id ? 'Hide' : 'Raw'}
                        </button>
                      )}
                    </div>
                  </div>
                  {l.error_message && <div className="text-sw-red text-[11px] mt-1">{l.error_message}</div>}
                  {expanded === l.id && l.nrs_response && (
                    <pre className="mt-2 p-2 bg-black/30 rounded text-[10px] text-sw-dim overflow-auto max-h-[300px]">
                      {JSON.stringify(l.nrs_response, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
