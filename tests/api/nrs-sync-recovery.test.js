import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/lib/nrs-client', () => ({
  fetchNRSDailyStats: vi.fn(),
  parseNRSStatsToDailySales: vi.fn(() => ({ r1_net: 100, r1_gross: 120 })),
  pickNrsOwnedFields: vi.fn(f => f),
  validateNRSAuth: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/lib/extract-shifts', () => ({ extractShiftsFromNRS: vi.fn() }));
vi.mock('@/lib/telegram', () => ({ sendTelegram: vi.fn(), buildSyncSummaryMessage: vi.fn(() => 'msg') }));

import { GET } from '@/app/api/cron/nrs-sync/route';
import { createAdminClient } from '@/lib/supabase-server';
import { fetchNRSDailyStats, validateNRSAuth } from '@/lib/nrs-client';

const STORES = [
  { id: 's1', name: 'Kerens', nrs_store_id: 53039 },
  { id: 's2', name: 'Denison', nrs_store_id: 61345 },
  { id: 's3', name: 'Reno', nrs_store_id: 63560 },
];

const cronReq = (date = '2026-09-07') => ({
  url: `https://app.test/api/cron/nrs-sync?date=${date}`,
  headers: { get: (k) => (k === 'x-vercel-cron' ? '1' : null) },
});

// Minimal Supabase double: records every nrs_sync_log insert so tests can
// assert on what the Agent Logs page would show.
function makeSupabase({ syncHistory = [] } = {}) {
  const inserts = [];
  const client = {
    inserts,
    from(table) {
      if (table === 'stores') {
        const q = { select: () => q, not: () => q, order: async () => ({ data: STORES }) };
        return q;
      }
      if (table === 'nrs_sync_log') {
        const q = {
          insert: async (row) => { inserts.push(row); return { error: null }; },
          select: () => q,
          gte: () => q,
          lt: () => q,
          order: async () => ({ data: syncHistory, error: null }),
        };
        return q;
      }
      if (table === 'daily_sales') {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null }),
          insert: () => q,
          single: async () => ({ data: { id: 'ds1' }, error: null }),
        };
        return q;
      }
      if (table === 'activity_log') return { insert: async () => ({ error: null }) };
      if (table === 'cash_collections') {
        const q = { select: () => q, eq: async () => ({ data: [] }) };
        return q;
      }
      return { select: () => ({ eq: async () => ({ data: [] }) }), insert: async () => ({ error: null }) };
    },
  };
  return client;
}

const logRows = (supa) => supa.inserts.filter(r => r.sync_date !== undefined);
const failedRows = (supa) => logRows(supa).filter(r => r.status === 'failed');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateNRSAuth).mockResolvedValue({ valid: true });
});

describe('nrs-sync cron — failure handling', () => {
  it('never runs more than 2 NRS requests at once', async () => {
    let inFlight = 0, peak = 0;
    vi.mocked(fetchNRSDailyStats).mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return { data: {} };
    });
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase());

    await GET(cronReq());
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('one store failing does not stop the others', async () => {
    vi.mocked(fetchNRSDailyStats).mockImplementation(async (nrsId) => {
      if (nrsId === 61345) throw new Error('NRS daily stats → 500');
      return { data: {} };
    });
    const supa = makeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(supa);

    const body = await (await GET(cronReq())).json();
    expect(body.summary).toMatchObject({ created: 2, failed: 1 });
    expect(failedRows(supa)).toHaveLength(1);
  });

  it('stores the structured detail so the Details expander has content', async () => {
    const err = new Error('NRS daily stats → 500 after 3 attempts: (empty response body)');
    err.detail = { label: 'daily stats', status: 500, attempts: 3, hint: 'NRS is down or the token expired' };
    vi.mocked(fetchNRSDailyStats).mockRejectedValue(err);
    const supa = makeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(supa);

    await GET(cronReq());
    expect(failedRows(supa)[0].error_detail).toEqual(err.detail);
  });

  // When every store fails at once the cause is shared, not per-store.
  it('says the token is bad when all stores fail and auth does not validate', async () => {
    vi.mocked(fetchNRSDailyStats).mockRejectedValue(new Error('NRS daily stats → 500'));
    vi.mocked(validateNRSAuth).mockResolvedValue({ valid: false });
    const supa = makeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(supa);

    await GET(cronReq());
    expect(validateNRSAuth).toHaveBeenCalledTimes(1);
    for (const row of failedRows(supa)) {
      expect(row.error_message).toContain('token is NOT valid');
    }
  });

  it('calls it an NRS outage when all stores fail but the token is good', async () => {
    vi.mocked(fetchNRSDailyStats).mockRejectedValue(new Error('NRS daily stats → 500'));
    const supa = makeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(supa);

    await GET(cronReq());
    expect(failedRows(supa)[0].error_message).toContain('NRS-side outage');
  });

  it('does not run the auth check when only some stores fail', async () => {
    vi.mocked(fetchNRSDailyStats).mockImplementation(async (nrsId) => {
      if (nrsId === 61345) throw new Error('boom');
      return { data: {} };
    });
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase());

    await GET(cronReq());
    expect(validateNRSAuth).not.toHaveBeenCalled();
  });
});

describe('nrs-sync cron — recovering earlier failures', () => {
  it('re-runs a store/date whose last log entry is a failure', async () => {
    vi.mocked(fetchNRSDailyStats).mockResolvedValue({ data: {} });
    const supa = makeSupabase({
      syncHistory: [{ store_id: 's1', sync_date: '2026-09-05', status: 'failed', created_at: '2026-09-05T09:00:00Z' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(supa);

    const body = await (await GET(cronReq())).json();
    expect(body.recovery).toEqual({ attempted: 1, recovered: 1 });
    // 3 stores for today + the recovered backfill day.
    expect(logRows(supa).filter(r => r.sync_date === '2026-09-05')).toHaveLength(1);
  });

  it('leaves a date alone once a later run succeeded', async () => {
    vi.mocked(fetchNRSDailyStats).mockResolvedValue({ data: {} });
    const supa = makeSupabase({
      syncHistory: [
        { store_id: 's1', sync_date: '2026-09-05', status: 'failed', created_at: '2026-09-05T09:00:00Z' },
        { store_id: 's1', sync_date: '2026-09-05', status: 'success', created_at: '2026-09-06T09:00:00Z' },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(supa);

    const body = await (await GET(cronReq())).json();
    expect(body.recovery).toEqual({ attempted: 0, recovered: 0 });
  });

  it('skips the recovery pass entirely when the token is the problem', async () => {
    vi.mocked(fetchNRSDailyStats).mockRejectedValue(new Error('NRS daily stats → 500'));
    vi.mocked(validateNRSAuth).mockResolvedValue({ valid: false });
    const supa = makeSupabase({
      syncHistory: [{ store_id: 's1', sync_date: '2026-09-05', status: 'failed', created_at: '2026-09-05T09:00:00Z' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(supa);

    const body = await (await GET(cronReq())).json();
    expect(body.recovery).toEqual({ attempted: 0, recovered: 0 });
  });

  it('logs a retry that is still failing, tagged as a retry', async () => {
    vi.mocked(fetchNRSDailyStats).mockImplementation(async (_id, date) => {
      if (date === '2026-09-05') throw new Error('still down');
      return { data: {} };
    });
    const supa = makeSupabase({
      syncHistory: [{ store_id: 's1', sync_date: '2026-09-05', status: 'failed', created_at: '2026-09-05T09:00:00Z' }],
    });
    vi.mocked(createAdminClient).mockReturnValue(supa);

    const body = await (await GET(cronReq())).json();
    expect(body.recovery).toEqual({ attempted: 1, recovered: 0 });
    const retryRow = logRows(supa).find(r => r.sync_date === '2026-09-05');
    expect(retryRow).toMatchObject({ status: 'failed' });
    expect(retryRow.error_message).toContain('Retry failed:');
  });
});

describe('nrs-sync cron — sync_log insert resilience', () => {
  it('still records the failure if error_detail is not in the schema yet', async () => {
    vi.mocked(fetchNRSDailyStats).mockRejectedValue(new Error('NRS daily stats → 500'));
    const attempts = [];
    const supa = makeSupabase();
    const realFrom = supa.from.bind(supa);
    supa.from = (table) => {
      if (table !== 'nrs_sync_log') return realFrom(table);
      const q = realFrom(table);
      return {
        ...q,
        insert: async (row) => {
          attempts.push(row);
          if ('error_detail' in row) return { error: { message: 'column "error_detail" does not exist' } };
          supa.inserts.push(row);
          return { error: null };
        },
      };
    };
    vi.mocked(createAdminClient).mockReturnValue(supa);

    await GET(cronReq());
    expect(attempts.some(r => 'error_detail' in r)).toBe(true);
    const stored = failedRows(supa);
    expect(stored).toHaveLength(3);
    expect(stored[0]).not.toHaveProperty('error_detail');
    expect(stored[0].error_message).toContain('NRS daily stats → 500');
  });
});
