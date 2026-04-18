'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Loading, SmartDatePicker, Field } from '@/components/UI';
import { downloadCSV } from '@/lib/utils';

export default function NRSBackfillPage() {
  const { supabase, isOwner } = useAuth();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStores, setSelectedStores] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  // Live progress
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [counts, setCounts] = useState({ created: 0, skipped: 0, failed: 0 });
  const [results, setResults] = useState([]);
  const [currentTask, setCurrentTask] = useState('');
  const [done, setDone] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [avgMs, setAvgMs] = useState(0);

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
    setInterrupted(false);
    setError('');
    setResults([]);
    setCurrent(0);
    setTotal(0);
    setCounts({ created: 0, skipped: 0, failed: 0 });
    setCurrentTask('Starting…');
    setAvgMs(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const durations = [];
    const accCounts = { created: 0, skipped: 0, failed: 0 };
    const accResults = [];

    try {
      const res = await fetch('/api/nrs/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_ids: selectedStores, start_date: startDate, end_date: endDate }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setCurrent(data.current);
                setTotal(data.total);
                setCurrentTask(`${data.store} — ${data.date}`);
                accCounts[data.status] = (accCounts[data.status] || 0) + 1;
                setCounts({ ...accCounts });
                accResults.push(data);
                setResults([...accResults]);
                if (data.duration_ms) {
                  durations.push(data.duration_ms);
                  setAvgMs(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length));
                }
              } else if (eventType === 'complete') {
                setDone(true);
                setCurrent(data.total);
                setTotal(data.total);
                setCounts({ created: data.created, skipped: data.skipped, failed: data.failed });
              }
            } catch {}
            eventType = '';
          }
        }
      }

      if (!done) setInterrupted(true);
    } catch (e) {
      if (e.name === 'AbortError') {
        setInterrupted(true);
      } else {
        setError(e.message);
        if (accResults.length > 0) setInterrupted(true);
      }
    } finally {
      setRunning(false);
      setCurrentTask('');
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const remaining = total > current && avgMs > 0 ? Math.ceil(((total - current) * avgMs) / 1000) : 0;
  const remMin = Math.floor(remaining / 60);
  const remSec = remaining % 60;

  const exportResults = () => {
    if (!results.length) return;
    downloadCSV('nrs-backfill-results.csv', ['Store', 'Date', 'Status', 'Gross', 'Duration(ms)', 'Error'],
      results.map(r => [r.store, r.date, r.status, r.gross || '', r.duration_ms, r.error || '']));
  };

  return (
    <div>
      <PageHeader title="🤖 7S Agent — Historical Backfill" subtitle="Import historical daily sales from NRS POS" />

      <div className="bg-sw-card rounded-xl border border-sw-border p-5 mb-4">
        <p className="text-sw-sub text-[12px] mb-4">
          Streams results in real-time. Existing entries are automatically skipped. If the connection drops, click Resume — already-imported dates won't be duplicated.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Start Date"><SmartDatePicker value={startDate} onChange={setStartDate} /></Field>
          <Field label="End Date"><SmartDatePicker value={endDate} onChange={setEndDate} /></Field>
        </div>

        {totalCalls > 0 && !running && (
          <div className="bg-sw-card2 rounded-lg p-3 border border-sw-border mb-4 text-[12px] text-sw-sub">
            {selectedStores.length} store{selectedStores.length === 1 ? '' : 's'} x {totalDays} day{totalDays === 1 ? '' : 's'} = <span className="text-sw-text font-bold">{totalCalls} tasks</span>
          </div>
        )}

        {/* Live progress */}
        {(running || (current > 0 && !done)) && (
          <div className="mb-4">
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-sw-text font-semibold">
                {current} / {total || '?'} processed
                {currentTask && <span className="text-sw-dim ml-2">— {currentTask}</span>}
              </span>
              <span className="text-sw-sub">
                {counts.created} created · {counts.skipped} skipped · {counts.failed} failed
              </span>
            </div>
            <div className="w-full bg-sw-card2 rounded-full h-3 border border-sw-border">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #22C55E, #3B82F6)' }}
              />
            </div>
            <div className="flex justify-between text-sw-dim text-[10px] mt-1">
              <span>{pct}%</span>
              {remaining > 0 && <span>~{remMin > 0 ? `${remMin}m ` : ''}{remSec}s remaining</span>}
            </div>
          </div>
        )}

        {error && <div className="bg-sw-redD text-sw-red border border-sw-red/30 rounded-lg p-3 mb-3 text-[12px]">{error}</div>}

        {interrupted && !running && (
          <div className="bg-sw-amberD text-sw-amber border border-sw-amber/30 rounded-lg p-3 mb-3 text-[12px]">
            Backfill interrupted at {current}/{total}. Click <strong>Resume</strong> to continue — already-imported dates will be skipped.
          </div>
        )}

        {done && !running && (
          <div className="bg-sw-greenD text-sw-green border border-sw-green/30 rounded-lg p-3 mb-3 text-[13px] font-semibold">
            Backfill complete: {counts.created} created, {counts.skipped} skipped, {counts.failed} failed
          </div>
        )}

        <div className="flex gap-2">
          {!running && (
            <Button onClick={run} disabled={!selectedStores.length || !startDate || !endDate}>
              {interrupted ? 'Resume' : (done ? 'Run Again' : 'Start Backfill')}
            </Button>
          )}
          {running && (
            <Button variant="secondary" onClick={cancel}>Cancel</Button>
          )}
          {results.length > 0 && !running && (
            <Button variant="secondary" onClick={exportResults} className="!text-[11px]">Download CSV</Button>
          )}
        </div>
      </div>

      {/* Results table */}
      {results.length > 0 && (
        <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
          <div className="max-h-[400px] overflow-auto">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="hidden sm:table-cell">Gross</th>
                  <th className="hidden sm:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
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
                    <td className="hidden sm:table-cell text-sw-dim text-[11px] font-mono">{r.gross ? `$${r.gross}` : '—'}</td>
                    <td className="hidden sm:table-cell text-sw-dim text-[10px]">{r.duration_ms}ms</td>
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
