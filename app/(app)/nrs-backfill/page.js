'use client';
import { useState, useEffect } from 'react';
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
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

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
  const estimatedMinutes = Math.ceil(totalCalls * 0.6 / 60);

  const toggleStore = (id) => {
    setSelectedStores(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const run = async () => {
    setRunning(true);
    setResults(null);
    setError('');
    try {
      const res = await fetch('/api/nrs/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_ids: selectedStores, start_date: startDate, end_date: endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backfill failed');
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const exportResults = () => {
    if (!results?.results) return;
    downloadCSV('nrs-backfill-results.csv', ['Store', 'Date', 'Status', 'Message'],
      results.results.map(r => [r.store, r.date, r.status, r.message]));
  };

  return (
    <div>
      <PageHeader title="NRS Historical Data Backfill" subtitle="Import historical daily sales from NRS POS" />

      <div className="bg-sw-card rounded-xl border border-sw-border p-5 mb-4">
        <p className="text-sw-sub text-[12px] mb-4">
          Import historical daily sales from NRS for selected stores and date range. Existing entries will not be overwritten.
        </p>

        <div className="mb-4">
          <div className="text-sw-sub text-[10px] font-bold uppercase mb-2">Stores</div>
          <div className="flex gap-2 flex-wrap">
            {stores.map(s => (
              <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer min-h-[44px] ${selectedStores.includes(s.id) ? 'bg-sw-blueD border-sw-blue/30 text-sw-blue' : 'bg-sw-card2 border-sw-border text-sw-text'}`}>
                <input type="checkbox" checked={selectedStores.includes(s.id)} onChange={() => toggleStore(s.id)} className="!w-4 !h-4 !min-h-0" />
                <span className="text-[12px] font-semibold">{s.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Field label="Start Date"><SmartDatePicker value={startDate} onChange={setStartDate} /></Field>
          <Field label="End Date"><SmartDatePicker value={endDate} onChange={setEndDate} /></Field>
        </div>

        {totalCalls > 0 && (
          <div className="bg-sw-card2 rounded-lg p-3 border border-sw-border mb-4 text-[12px] text-sw-sub">
            {selectedStores.length} store{selectedStores.length === 1 ? '' : 's'} x {totalDays} day{totalDays === 1 ? '' : 's'} = <span className="text-sw-text font-bold">{totalCalls} API calls</span>
            <span className="text-sw-dim ml-2">~{estimatedMinutes} min</span>
          </div>
        )}

        {error && <div className="bg-sw-redD text-sw-red border border-sw-red/30 rounded-lg p-3 mb-3 text-[12px]">{error}</div>}

        <Button onClick={run} disabled={running || !selectedStores.length || !startDate || !endDate}>
          {running ? 'Running Backfill…' : 'Start Backfill'}
        </Button>
      </div>

      {results && (
        <div className="bg-sw-card rounded-xl border border-sw-border p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sw-text text-[14px] font-bold">
              Results: {results.created} created, {results.skipped} skipped, {results.failed} failed
            </div>
            <Button variant="secondary" onClick={exportResults} className="!text-[11px]">Download CSV</Button>
          </div>
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
                {results.results.map((r, i) => (
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
