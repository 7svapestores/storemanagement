import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/lib/nrs-pricebook', () => ({ listPricebookItems: vi.fn() }));

import { POST as syncPOST } from '@/app/api/pricebook/catalog/sync/route';
import { GET as itemsGET } from '@/app/api/pricebook/catalog/items/route';
import { GET as catalogGET } from '@/app/api/pricebook/catalog/route';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { listPricebookItems } from '@/lib/nrs-pricebook';

const STORES = [
  { id: 'reno', name: 'Reno', nrs_store_id: 63560 },
  { id: 'troup', name: 'Troup', nrs_store_id: 78089 },
];

let upserted, deleted, cachedRows, rpcResult;

function mockDb(role = 'owner') {
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: role ? { id: 'u1' } : null } }) },
  });
  vi.mocked(createAdminClient).mockReturnValue({
    rpc: async (fn, args) => rpcResult(fn, args),
    from: (table) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, name: 'Owner' } : null }) }) }) };
      }
      if (table === 'stores') {
        const b = (rows) => ({
          select: () => b(rows),
          in: (_c, ids) => b(rows.filter(s => ids.includes(s.id))),
          order: async () => ({ data: rows }),
        });
        return b(STORES);
      }
      // pricebook_items
      const q = {
        select: () => q,
        like: (_c, pattern) => {
          const prefix = pattern.replace(/%$/, '');
          return { ...q, order: () => ({ limit: async () => ({ data: cachedRows.filter(r => r.upc.startsWith(prefix)) }) }) };
        },
        eq: () => q,
        neq: (_c, runId) => { deleted.push(runId); return Promise.resolve({ error: null }); },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: { synced_at: '2026-09-09T00:00:00Z' } }),
        upsert: async (rows) => { upserted.push(...rows); return { error: null }; },
        delete: () => ({ eq: () => ({ neq: (_c, runId) => { deleted.push(runId); return Promise.resolve({ error: null }); } }) }),
      };
      return q;
    },
  });
}

const syncReq = (body) => ({ json: async () => body });
const getReq = (qs) => ({ url: `https://app.test/x?${qs}` });
const page = (n, start = 0) => ({
  items: Array.from({ length: n }, (_, i) => ({
    upc: `81008${String(start + i).padStart(4, '0')}`, name: `Item ${start + i}`, cents: 2299, cost_cents: 1000,
  })),
  recordsFiltered: 450,
});

beforeEach(() => {
  vi.clearAllMocks();
  upserted = []; deleted = []; cachedRows = [];
  rpcResult = async () => ({ data: [], error: null });
  mockDb();
});

describe('POST /api/pricebook/catalog/sync', () => {
  it('caches a page and reports where to continue', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue(page(200));
    const body = await (await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'r1' }))).json();

    expect(body).toMatchObject({ fetched: 200, cached: 200, next_start: 200, done: false });
    expect(upserted).toHaveLength(200);
    expect(upserted[0]).toMatchObject({ store_id: 'reno', upc: '810080000', cents: 2299, run_id: 'r1' });
  });

  it('stops when NRS returns a short page', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue({ items: page(50).items, recordsFiltered: 450 });
    const body = await (await syncPOST(syncReq({ store_id: 'reno', start: 400, run_id: 'r1' }))).json();
    expect(body).toMatchObject({ done: true, next_start: null });
  });

  // Items deleted in the POS must not linger in the cache as phantom rows.
  it('clears rows left behind by an earlier pass once finished', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue({ items: page(3).items, recordsFiltered: 3 });
    await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'run-2' }));
    expect(deleted).toContain('run-2');
  });

  it('does not clear anything mid-sync', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue(page(200));
    await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'run-2' }));
    expect(deleted).toHaveLength(0);
  });

  it('asks NRS for the whole pricebook, not a search', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue(page(10));
    await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'r1' }));
    expect(vi.mocked(listPricebookItems).mock.calls[0][1]).toMatchObject({ search: '', start: 0 });
  });

  it('skips items with no UPC rather than caching blanks', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue({
      items: [{ upc: '810082001', name: 'Real', cents: 100 }, { upc: '', name: 'Blank', cents: 100 }],
      recordsFiltered: 2,
    });
    const body = await (await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'r1' }))).json();
    expect(body).toMatchObject({ fetched: 2, cached: 1 });
  });

  it('rejects a missing run_id and a negative start', async () => {
    expect((await syncPOST(syncReq({ store_id: 'reno', start: 0 }))).status).toBe(400);
    expect((await syncPOST(syncReq({ store_id: 'reno', start: -1, run_id: 'r' }))).status).toBe(400);
    expect(listPricebookItems).not.toHaveBeenCalled();
  });

  it('is owner-only', async () => {
    mockDb('employee');
    expect((await syncPOST(syncReq({ store_id: 'reno', start: 0, run_id: 'r' }))).status).toBe(403);
    expect(listPricebookItems).not.toHaveBeenCalled();
  });
});

describe('GET /api/pricebook/catalog/items', () => {
  beforeEach(() => {
    cachedRows = [
      { store_id: 'reno', upc: '810082001', name: 'Geekbar Pulse Watermelon', cents: 2299 },
      { store_id: 'troup', upc: '810082001', name: 'GEEKBAR PULSE WATERMELON', cents: 2399 },
      { store_id: 'reno', upc: '810082002', name: 'Geekbar Pulse Mint', cents: 2299 },
      { store_id: 'reno', upc: '999999999', name: 'Lighter', cents: 199 },
    ];
  });

  it('returns one row per UPC with a price per store', async () => {
    const body = await (await itemsGET(getReq('prefix=810082'))).json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows.find(r => r.upc === '810082001').prices).toEqual({ reno: 2299, troup: 2399 });
  });

  it('only returns UPCs under the requested prefix', async () => {
    const body = await (await itemsGET(getReq('prefix=810082'))).json();
    expect(body.rows.map(r => r.upc)).not.toContain('999999999');
  });

  // The prefix is interpolated into a LIKE pattern.
  it('rejects a prefix that is not plain digits', async () => {
    for (const bad of ['81%', "8'; drop", 'abc', '81', '']) {
      expect((await itemsGET(getReq(`prefix=${encodeURIComponent(bad)}`))).status).toBe(400);
    }
  });

  it('is owner-only', async () => {
    mockDb(null);
    expect((await itemsGET(getReq('prefix=810082'))).status).toBe(401);
  });
});

describe('GET /api/pricebook/catalog', () => {
  it('returns UPC prefix groups from the database rollup', async () => {
    rpcResult = async (fn, args) => {
      expect(fn).toBe('pricebook_upc_prefixes');
      expect(args).toEqual({ p_len: 6 });
      return { data: [{ prefix: '810082', upc_count: 12, store_count: 5, sample_name: 'Geekbar Pulse', min_cents: 2299, max_cents: 2399 }], error: null };
    };
    const body = await (await catalogGET(getReq('prefix_len=6'))).json();
    expect(body.groups[0]).toMatchObject({ prefix: '810082', upc_count: 12 });
    expect(body.prefixLen).toBe(6);
  });

  it('clamps a silly prefix length to the default', async () => {
    let seen;
    rpcResult = async (_fn, args) => { seen = args; return { data: [], error: null }; };
    await catalogGET(getReq('prefix_len=99'));
    expect(seen).toEqual({ p_len: 6 });
  });

  it('says the migration is missing rather than leaking a Postgres error', async () => {
    rpcResult = async () => ({ data: null, error: { message: 'function public.pricebook_upc_prefixes(integer) does not exist' } });
    const res = await catalogGET(getReq(''));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/add-pricebook-catalog\.sql/);
  });

  it('is owner-only', async () => {
    mockDb('employee');
    expect((await catalogGET(getReq(''))).status).toBe(403);
  });
});
