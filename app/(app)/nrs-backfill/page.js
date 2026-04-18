'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Loading, SmartDatePicker, Field } from '@/components/UI';
import { fmt, downloadCSV } from '@/lib/utils';

export default function NRSBackfillPage() {
  const { supabase, isOwner } = useAuth();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStores, setSelectedStores] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [batchSize, setBatchSize] = useState(10);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const cancelRef = useRef(false);
  const [error, setError] = useState('');

  // Progress tracking
  const [totalTasks, setTotalTasks] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [totals, setTotals] = useState({ created: 0, skipped: 0, failed: 0 });
  const [allResults, setAllResults] = useState([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('stores').select('id, name, nrs_store_id').order('created_at');
      const nrs = (data || []).filter(s => s.nrs_store_id);
      setStores(nrs);
      setSelectedStores(nrs.map(s => s.id));
      setLoading(false);
    })();
  }, []);

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const totalDays = (() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate + 'T12:00:00'), e = new Date(endDate + 'T12:00:00');
    return Math.max(0, Math.round((e - s) / 86400000) + 1);
  })();
  const totalCalls = totalDays * selectedStores.length;

  const toggleStore = (id) => {
    setSelectedStores(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const run = async () => {
    setRunning(true);
    setDone(false);
    setCancelled(false);
    cancelRef.current = false;
    setError('');
    setAllResults([]);
    setProcessed(0);
    setTotalTasks(0);
    setTotals({ created: 0, skipped: 0, failed: 0 });

    let cursor = 0;
    let total = 0;
    const cumTotals = { created: 0, skipped: 0, failed: 0 };
    const cumResults = [];

    try {
      while (true) {
        if (cancelRef.current) break;

        const res = await fetch('/api/nrs/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_ids: selectedStores,
            start_date: startDate,
            end_date: endDate,
            batch_size: batchSize,
            cursor,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch failed');

        if (total === 0) {
          total = data.total_tasks;
          setTotalTasks(total);
        }

        cumTotals.created += data.batch_summary.created;
        cumTotals.skipped += data.batch_summary.skipped;
        cumTotals.failed += data.batch_summary.failed;
        cumResults.push(...data.results_this_batch);

        setProcessed(data.cursor_next);
        setTotals({ ...cumTotals });
        setAllResults([...cumResults]);

        if (!data.has_more) break;
        cursor = data.cursor_next;
      }
    } catch (e) {
      setError(e.message);
    }

    setDone(true);
    setRunning(false);
    if (cancelRef.current) setCancelled(true);
  };

  const cancel = () => {
    cancelRef.current = true;
  };

  const pct = totalTasks > 0 ? Math.round((processed / totalTasks) * 100) : 0;

  const exportResults = () => {
    if (!allResults.length) return;
    downloadCSV('nrs-backfill-results.csv', ['Store', 'Date', 'Status', 'Message'],
      allResults.map(r => [r.store, r.date, r.status, r.message]));
  };

  return (
    <div>
      <PageHeader title="🤖 7S Agent — Historical Backfill" subtitle="Import historical daily sales from NRS POS" />

      <div className="bg-sw-card rounded-xl border border-sw-border p-5 mb-4">
        <p className="text-sw-sub text-[12px] mb-4">
          Import historical daily sales from NRS for selected stores and date range. Existing entries will not be overwritten. Processes in batches to avoid timeouts.
        </p>

        <div className="mb-4">
          <div className="text-sw-sub text-[10px] font-bold uppercase mb-2">Stores</div>
          <div className="flex gap-2 flex-wrap">
            {stores.map(s => (
              <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer min-h-[44px] ${selectedStores.includes(s.id) ? 'bg-sw-blueD border-sw-blue/30 text-sw-blue' : 'bg-sw-card2 border-sw-border text-sw-text'}`}>
                <input type="checkbox" checked={selectedStores.includes(s.id)} onChange={() => toggleStore(s.id)} disabled={running} className="!w-4 !h-4 !min-h-0" />
                <span className="text-[12px] font-semibold">{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Field label="Start Date"><SmartDatePicker value={startDate} onChange={setStartDate} /></Field>
          <Field label="End Date"><SmartDatePicker value={endDate} onChange={setEndDate} /></Field>
          <Field label="Batch Size">
            <input type="number" min="5" max="20" value={batchSize} onChange={e => setBatchSize(Math.max(5, Math.min(20, Number(e.target.value) || 10)))} disabled={running} />
          </Field>
        </div>

        {totalCalls > 0 && !running && (
          <div className="bg-sw-card2 rounded-lg p-3 border border-sw-border mb-4 text-[12px] text-sw-sub">
            {selectedStores.length} store{selectedStores.length === 1 ? '' : 's'} x {totalDays} day{totalDays === 1 ? '' : 's'} = <span className="text-sw-text font-bold">{totalCalls} tasks</span>
            <span className="text-sw-dim ml-2">in batches of {batchSize}</span>
          </div>
        )}

        {/* Progress bar */}
        {running && (
          <div className="mb-4">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-sw-text font-semibold">{processed} / {totalTasks || '?'} processed</span>
              <span className="text-sw-sub">
                {totals.created} created · {totals.skipped} skipped · {totals.failed} failed
              </span>
            </div>
            <div className="w-full bg-sw-card2 rounded-full h-3 border border-sw-border">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-sw-dim text-[10px] mt-1">{pct}% complete</div>
          </div>
        )}

        {error && <div className="bg-sw-redD text-sw-red border border-sw-red/30 rounded-lg p-3 mb-3 text-[12px]">{error}</div>}
        {cancelled && <div className="bg-sw-amberD text-sw-amber border border-sw-amber/30 rounded-lg p-3 mb-3 text-[12px]">Backfill cancelled by user. {processed} of {totalTasks} tasks were processed.</div>}

        <div className="flex gap-2">
          <Button onClick={run} disabled={running || !selectedStores.length || !startDate || !endDate}>
            {running ? 'Running…' : 'Start Backfill'}
          </Button>
          {running && (
            <Button variant="secondary" onClick={cancel}>Cancel</Button>
          )}
        </div>
      </div>

      {/* Done summary */}
      {done && !running && allResults.length > 0 && (
        <div className="bg-sw-card rounded-xl border border-sw-border p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sw-text text-[14px] font-bold">
              {cancelled ? 'Partial Results' : 'Backfill Complete'}
            </div>
            <Button variant="secondary" onClick={exportResults} className="!text-[11px]">Download CSV</Button>
          </div>
          <div className="text-sw-sub text-[12px] mb-3">
            {totals.created} created · {totals.skipped} skipped · {totals.failed} failed
          </div>
        </div>
      )}

      {/* Results table */}
      {allResults.length > 0 && (
        <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
          <div className="max-h-[400px] overflow-auto">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {allResults.map((r, i) => (
                  <tr key={i}>
                    <td className="text-[12px]">{r.store}</td>
                    <td className="text-[12px] font-mono">{r.date}</td>
                    <td>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        r.status === 'created' ? 'bg-sw-greenD text-sw-green' :
                        r.status === 'skipped' ? 'bg-sw-amberD text-sw-amber' :
                        'bg-sw-redD text-sw-red'
                      }`}>{r.status}</span>
                    </td>
                    <td className="text-sw-dim text-[11px]">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
