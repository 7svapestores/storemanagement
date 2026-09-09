'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

// Compact NRS / sync status strip rendered in AppShell so every page shows
// the same "is the agent talking to NRS, and when did it last run" signal.
// Owner-only, matching the owner gate on /api/nrs/validate; the strip is
// hidden for employees to keep the employee UI clean.
function relativeTime(iso) {
  if (!iso) return '—';
  const sec = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default function NrsStatusBar() {
  const { supabase, isOwner } = useAuth();
  const [nrsStatus, setNrsStatus] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch('/api/nrs/validate')
      .then(r => r.json())
      .then(d => { if (!cancelled) setNrsStatus(d?.valid === true); })
      .catch(() => { if (!cancelled) setNrsStatus(false); });
    supabase
      .from('nrs_sync_log')
      .select('sync_date, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (cancelled || !data?.length) return;
        const latest = data[0];
        setLastSync({
          date: latest.sync_date,
          time: latest.created_at,
          success: data.filter(l => l.status === 'success' && l.sync_date === latest.sync_date).length,
          failed: data.filter(l => l.status === 'failed' && l.sync_date === latest.sync_date).length,
        });
      });
    return () => { cancelled = true; };
  }, [isOwner, supabase]);

  if (!isOwner) return null;

  return (
    <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap px-3 py-1.5 mb-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px]">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
        <span className="text-[var(--color-success)] font-semibold">Live</span>
      </span>
      {nrsStatus !== null && (
        <span className={`flex items-center gap-1.5 ${nrsStatus ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
          <span className={`w-2 h-2 rounded-full ${nrsStatus ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
          <span className="font-semibold">{nrsStatus ? 'NRS Connected' : 'NRS Invalid'}</span>
        </span>
      )}
      {lastSync && (
        <span className="text-[var(--text-muted)] flex items-center gap-1.5">
          <span>Last sync</span>
          <span className="text-[var(--text-secondary)] font-mono">{lastSync.date}</span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="text-[var(--text-secondary)]">{relativeTime(lastSync.time)}</span>
          {lastSync.failed > 0 && (
            <span className="ml-1 text-[var(--color-danger)] font-semibold">
              ({lastSync.failed} failed)
            </span>
          )}
        </span>
      )}
    </div>
  );
}
