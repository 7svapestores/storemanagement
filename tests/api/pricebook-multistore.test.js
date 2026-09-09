import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/lib/nrs-pricebook', () => ({
  listPricebookItems: vi.fn(),
  updatePricebookItemPrice: vi.fn(),
}));

import { GET as matrixGET } from '@/app/api/pricebook/matrix/route';
import { POST as bulkPOST } from '@/app/api/pricebook/bulk-update/route';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { listPricebookItems, updatePricebookItemPrice } from '@/lib/nrs-pricebook';

const STORES = [
  { id: 'reno', name: 'Reno', nrs_store_id: 63560 },
  { id: 'troup', name: 'Troup', nrs_store_id: 78089 },
  { id: 'denison', name: 'Denison', nrs_store_id: 61345 },
];

function mockAuth(role = 'owner', name = 'Owner') {
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: role ? { id: 'u1' } : null } }) },
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, name } : null }) }) }) };
      }
      // stores — chainable, with order() as the terminal awaited call
      const builder = (rows) => ({
        select: () => builder(rows),
        in: (_col, ids) => builder(rows.filter(s => ids.includes(s.id))),
        order: async () => ({ data: rows }),
      });
      return builder(STORES);
    },
  });
}

const matrixReq = (qs) => ({ url: `https://app.test/api/pricebook/matrix?${qs}` });
const bulkReq = (body) => ({ json: async () => body });
const item = (upc, name, cents) => ({ upc, name, cents });

beforeEach(() => { vi.clearAllMocks(); mockAuth(); });

describe('GET /api/pricebook/matrix', () => {
  it('groups one UPC across every store into a single row', async () => {
    vi.mocked(listPricebookItems).mockImplementation(async (nrsId) => ({
      items: [item('810082001', 'Geekbar Pulse Watermelon', nrsId === 61345 ? 2399 : 2299)],
    }));

    const body = await (await matrixGET(matrixReq('q=geekbar'))).json();
    expect(body.families).toHaveLength(1);
    const row = body.families[0].items[0];
    expect(row.prices).toEqual({ reno: 2299, troup: 2299, denison: 2399 });
  });

  it('searches every store', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue({ items: [] });
    await matrixGET(matrixReq('q=geekbar'));
    expect(listPricebookItems).toHaveBeenCalledTimes(3);
    expect(vi.mocked(listPricebookItems).mock.calls.map(c => c[0]).sort())
      .toEqual([61345, 63560, 78089]);
  });

  // A store that errors must not look like a store that doesn't stock the item.
  it('still returns results when one store fails, and names it', async () => {
    vi.mocked(listPricebookItems).mockImplementation(async (nrsId) => {
      if (nrsId === 61345) throw new Error('NRS daily stats → 500');
      return { items: [item('810082001', 'Geekbar Pulse', 2299)] };
    });

    const res = await matrixGET(matrixReq('q=geekbar'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toEqual([{ store: 'Denison', error: 'NRS daily stats → 500' }]);
    expect(body.families[0].items[0].prices.denison).toBeUndefined();
  });

  it('fails the request only when every store fails', async () => {
    vi.mocked(listPricebookItems).mockRejectedValue(new Error('NRS down'));
    expect((await matrixGET(matrixReq('q=geekbar'))).status).toBe(502);
  });

  it('rejects a search too short to be useful', async () => {
    expect((await matrixGET(matrixReq('q=g'))).status).toBe(400);
    expect(listPricebookItems).not.toHaveBeenCalled();
  });

  it('honours an owner-supplied variant digit count', async () => {
    vi.mocked(listPricebookItems).mockResolvedValue({
      items: [item('810082001', 'Geekbar Pulse A', 2299), item('810082101', 'Geekbar Pulse B', 2299)],
    });
    const wide = await (await matrixGET(matrixReq('q=geek&variant_digits=3'))).json();
    const narrow = await (await matrixGET(matrixReq('q=geek&variant_digits=2'))).json();
    expect(wide.families).toHaveLength(1);
    expect(narrow.families).toHaveLength(2);
  });

  it('is owner-only', async () => {
    mockAuth('employee');
    expect((await matrixGET(matrixReq('q=geekbar'))).status).toBe(403);
    mockAuth(null);
    expect((await matrixGET(matrixReq('q=geekbar'))).status).toBe(401);
    expect(listPricebookItems).not.toHaveBeenCalled();
  });
});

describe('POST /api/pricebook/bulk-update', () => {
  const twoWrites = {
    writes: [
      { store_id: 'reno', upc: '810082001', cents: 2499 },
      { store_id: 'troup', upc: '810082001', cents: 2499 },
    ],
  };

  it('writes each store with that store’s NRS id', async () => {
    vi.mocked(updatePricebookItemPrice).mockResolvedValue({ old_cents: 2299, new_cents: 2499 });
    const body = await (await bulkPOST(bulkReq(twoWrites))).json();

    expect(body).toMatchObject({ updated: 2, failed: 0 });
    expect(vi.mocked(updatePricebookItemPrice).mock.calls.map(c => c[0]).sort())
      .toEqual([63560, 78089]);
  });

  it('reports a per-store failure without losing the successes', async () => {
    vi.mocked(updatePricebookItemPrice).mockImplementation(async (nrsId) => {
      if (nrsId === 78089) throw new Error('NRS rejected price update');
      return { old_cents: 2299, new_cents: 2499 };
    });

    const body = await (await bulkPOST(bulkReq(twoWrites))).json();
    expect(body).toMatchObject({ updated: 1, failed: 1 });
    const failed = body.results.find(r => !r.ok);
    expect(failed).toMatchObject({ store_name: 'Troup', upc: '810082001' });
    expect(failed.error).toContain('NRS rejected');
  });

  it('counts an already-correct price as unchanged, not updated', async () => {
    vi.mocked(updatePricebookItemPrice).mockResolvedValue({ old_cents: 2499, new_cents: 2499, unchanged: true });
    const body = await (await bulkPOST(bulkReq(twoWrites))).json();
    expect(body).toMatchObject({ updated: 0, unchanged: 2, failed: 0 });
  });

  // Validation runs before any write, so a bad row can't leave a half-applied batch.
  it('rejects an invalid price without writing anything', async () => {
    const res = await bulkPOST(bulkReq({ writes: [
      { store_id: 'reno', upc: '810082001', cents: 2499 },
      { store_id: 'troup', upc: '810082002', cents: -5 },
    ] }));
    expect(res.status).toBe(400);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });

  it('rejects a fractional price', async () => {
    const res = await bulkPOST(bulkReq({ writes: [{ store_id: 'reno', upc: '1', cents: 24.99 }] }));
    expect(res.status).toBe(400);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });

  it('rejects the same item written twice for one store', async () => {
    const res = await bulkPOST(bulkReq({ writes: [
      { store_id: 'reno', upc: '810082001', cents: 2499 },
      { store_id: 'reno', upc: '810082001', cents: 2599 },
    ] }));
    expect(res.status).toBe(400);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });

  it('allows the same item across different stores', async () => {
    vi.mocked(updatePricebookItemPrice).mockResolvedValue({ old_cents: 2299, new_cents: 2499 });
    expect((await bulkPOST(bulkReq(twoWrites))).status).toBe(200);
  });

  it('rejects a store with no NRS id', async () => {
    const res = await bulkPOST(bulkReq({ writes: [{ store_id: 'ghost', upc: '1', cents: 100 }] }));
    expect(res.status).toBe(400);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });

  it('caps the batch size', async () => {
    const writes = Array.from({ length: 301 }, (_, i) => ({ store_id: 'reno', upc: `u${i}`, cents: 100 }));
    expect((await bulkPOST(bulkReq({ writes }))).status).toBe(400);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    expect((await bulkPOST(bulkReq({ writes: [] }))).status).toBe(400);
  });

  it('attributes the change to the signed-in owner', async () => {
    mockAuth('owner', 'Sateesh');
    vi.mocked(updatePricebookItemPrice).mockResolvedValue({ old_cents: 1, new_cents: 2 });
    await bulkPOST(bulkReq({ writes: [{ store_id: 'reno', upc: '1', cents: 2 }] }));
    expect(vi.mocked(updatePricebookItemPrice).mock.calls[0][3]).toEqual({ user: 'Sateesh (StoreWise)' });
  });

  it('is owner-only', async () => {
    mockAuth('employee');
    expect((await bulkPOST(bulkReq(twoWrites))).status).toBe(403);
    mockAuth(null);
    expect((await bulkPOST(bulkReq(twoWrites))).status).toBe(401);
    expect(updatePricebookItemPrice).not.toHaveBeenCalled();
  });
});
