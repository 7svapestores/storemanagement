'use client';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Alert, Field } from '@/components/UI';

const CRON_URL = typeof window !== 'undefined' ? `${window.location.origin}/api/cron/nrs-sync` : '/api/cron/nrs-sync';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    <button onClick={copy} className="text-sw-blue text-[10px] font-semibold border border-sw-blue/30 rounded px-2 py-0.5 bg-sw-blueD ml-2">
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

export default function CronSetupPage() {
  const { isOwner } = useAuth();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  const testEndpoint = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError('');
    try {
      const res = await fetch('/api/cron/nrs-sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setTestResult(data);
    } catch (e) {
      setTestError(e.message);
    } finally {
      setTesting(false);
    }
  };

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;

  return (
    <div>
      <PageHeader title="🤖 7S Agent Setup" subtitle="Configure automated NRS sync" />

      {testError && <Alert type="error">{testError}</Alert>}
      {testResult && (
        <Alert type={testResult.success ? 'success' : 'warning'}>
          Test sync for {testResult.date_synced}: {testResult.summary.created} created, {testResult.summary.skipped} skipped, {testResult.summary.failed} failed ({testResult.duration_ms}ms)
        </Alert>
      )}

      <div className="bg-sw-card rounded-xl border border-sw-border p-5 mb-4">
        <h3 className="text-sw-text text-[15px] font-bold mb-3">Setting up 7S Agent (Automated Daily Sync)</h3>
        <p className="text-sw-sub text-[12px] mb-4">
          Use cron-job.org (free) to call the sync endpoint every night. This automatically imports yesterday's sales from NRS POS for all 5 stores.
        </p>

        <div className="space-y-4">
          <div className="bg-sw-card2 rounded-lg p-4 border border-sw-border">
            <div className="text-sw-text text-[13px] font-bold mb-1">1. Endpoint URL</div>
            <div className="bg-black/30 rounded px-3 py-2 text-sw-green font-mono text-[12px] break-all flex items-center justify-between gap-2">
              <span>{CRON_URL}</span>
              <CopyButton text={CRON_URL} />
            </div>
          </div>

          <div className="bg-sw-card2 rounded-lg p-4 border border-sw-border">
            <div className="text-sw-text text-[13px] font-bold mb-1">2. Authorization Header</div>
            <p className="text-sw-sub text-[11px] mb-2">Add this custom header in cron-job.org's "Headers" section:</p>
            <div className="bg-black/30 rounded px-3 py-2 text-sw-amber font-mono text-[12px] break-all flex items-center justify-between gap-2">
              <span>Authorization: Bearer YOUR_CRON_SECRET</span>
              <CopyButton text="Authorization: Bearer YOUR_CRON_SECRET" />
            </div>
            <p className="text-sw-dim text-[10px] mt-2">Replace YOUR_CRON_SECRET with the value from your Vercel environment variables.</p>
          </div>

          <div className="bg-sw-card2 rounded-lg p-4 border border-sw-border">
            <div className="text-sw-text text-[13px] font-bold mb-1">3. Schedule</div>
            <div className="bg-black/30 rounded px-3 py-2 text-sw-cyan font-mono text-[12px] flex items-center justify-between gap-2">
              <span>0 9 * * *</span>
              <CopyButton text="0 9 * * *" />
            </div>
            <p className="text-sw-dim text-[10px] mt-2">9:00 AM UTC = 3:00 AM CST / 4:00 AM CDT — runs daily after midnight Central Time.</p>
          </div>

          <div className="bg-sw-card2 rounded-lg p-4 border border-sw-border">
            <div className="text-sw-text text-[13px] font-bold mb-1">4. Request Method</div>
            <p className="text-sw-sub text-[12px]">Use <span className="text-sw-green font-bold">GET</span> (cron-job.org default). Both GET and POST are supported.</p>
          </div>

          <div className="bg-sw-card2 rounded-lg p-4 border border-sw-border">
            <div className="text-sw-text text-[13px] font-bold mb-2">5. Steps at cron-job.org</div>
            <ol className="text-sw-sub text-[12px] space-y-1.5 list-decimal ml-4">
              <li>Go to <span className="text-sw-blue">cron-job.org</span> and create a free account</li>
              <li>Click <span className="text-sw-text font-semibold">CREATE CRONJOB</span></li>
              <li>Paste the endpoint URL above</li>
              <li>Set schedule to <span className="font-mono text-sw-cyan">0 9 * * *</span></li>
              <li>Go to <span className="text-sw-text font-semibold">Advanced</span> tab</li>
              <li>Under <span className="text-sw-text font-semibold">Headers</span>, add:<br />
                Key: <span className="font-mono">Authorization</span><br />
                Value: <span className="font-mono">Bearer YOUR_CRON_SECRET</span>
              </li>
              <li>Click <span className="text-sw-text font-semibold">CREATE</span></li>
            </ol>
          </div>
        </div>
      </div>

      <div className="bg-sw-card rounded-xl border border-sw-border p-5">
        <h3 className="text-sw-text text-[15px] font-bold mb-3">Test the Endpoint</h3>
        <p className="text-sw-sub text-[12px] mb-3">
          Click below to run the sync now (as your logged-in user). This syncs yesterday's data for all stores.
        </p>
        <Button onClick={testEndpoint} disabled={testing}>
          {testing ? 'Running…' : 'Test Sync Now'}
        </Button>
        {testResult && (
          <div className="mt-3 bg-sw-card2 rounded-lg p-3 border border-sw-border">
            <div className="text-sw-text text-[12px] font-bold mb-2">Results for {testResult.date_synced}</div>
            <div className="space-y-1">
              {testResult.results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                    r.status === 'created' ? 'bg-sw-greenD text-sw-green' :
                    r.status === 'skipped' ? 'bg-sw-amberD text-sw-amber' :
                    'bg-sw-redD text-sw-red'
                  }`}>{r.status}</span>
                  <span className="text-sw-text font-semibold">{r.store_name}</span>
                  {r.error && <span className="text-sw-red text-[10px]">{r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
