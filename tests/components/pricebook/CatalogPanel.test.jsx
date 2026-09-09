import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CatalogPanel from '@/components/pricebook/CatalogPanel';

vi.mock('@/lib/utils', async (orig) => ({ ...(await orig()), downloadCSV: vi.fn() }));
import { downloadCSV } from '@/lib/utils';

const STORES = [{ id: 'reno', name: 'Reno' }, { id: 'troup', name: 'Troup' }];

const CATALOG = {
  prefixLen: 6,
  stores: STORES,
  syncStatus: [
    { store_id: 'reno', name: 'Reno', items: 1200, last_synced: '2026-09-09T00:00:00Z' },
    { store_id: 'troup', name: 'Troup', items: 1100, last_synced: '2026-09-09T00:00:00Z' },
  ],
  groups: [
    { prefix: '810082', upc_count: 12, store_count: 2, sample_name: 'Geekbar Pulse', min_cents: 2299, max_cents: 2399 },
    { prefix: '810099', upc_count: 4, store_count: 2, sample_name: 'Raz TN9000', min_cents: 1999, max_cents: 1999 },
  ],
  totalGroups: 2,
};

const ITEMS = {
  prefix: '810082',
  stores: STORES,
  rows: [
    { upc: '810082001', name: 'Geekbar Pulse Watermelon', names: {}, costs: {}, nameConflict: false, prices: { reno: 2299, troup: 2299 } },
    { upc: '810082002', name: 'Geekbar Pulse Mint', names: {}, costs: {}, nameConflict: false, prices: { reno: 2299, troup: 2299 } },
  ],
  truncated: false,
};

const EMPTY = { ...CATALOG, groups: [], totalGroups: 0, syncStatus: STORES.map(s => ({ store_id: s.id, name: s.name, items: 0, last_synced: null })) };

const route = (url) => {
  if (url.startsWith('/api/pricebook/catalog/items')) return ITEMS;
  if (url.startsWith('/api/pricebook/catalog')) return CATALOG;
  return {};
};

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async (url) => ({ ok: true, json: async () => route(String(url)) }));
});

describe('<CatalogPanel />', () => {
  it('divides the catalog by UPC prefix, not by name', async () => {
    render(<CatalogPanel />);
    expect(await screen.findByText('810082•••')).toBeInTheDocument();
    expect(screen.getByText('810099•••')).toBeInTheDocument();
  });

  it('shows how many UPCs and stores sit under each prefix', async () => {
    render(<CatalogPanel />);
    expect(await screen.findByText(/12 UPCs · 2 stores/)).toBeInTheDocument();
  });

  it('shows a price range when stores disagree, one price when they do not', async () => {
    render(<CatalogPanel />);
    expect(await screen.findByText('$22.99 – $23.99')).toBeInTheDocument();
    expect(screen.getByText('$19.99')).toBeInTheDocument();
  });

  it('regroups when the prefix length changes', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await screen.findByText('810082•••');
    await user.selectOptions(screen.getAllByRole('combobox')[0], '8');
    await waitFor(() => expect(global.fetch.mock.calls.at(-1)[0]).toContain('prefix_len=8'));
  });

  it('filters by UPC prefix', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await screen.findByText('810082•••');
    await user.type(screen.getByPlaceholderText(/Filter by UPC prefix or name/i), '810099');
    await waitFor(() => expect(screen.queryByText('810082•••')).not.toBeInTheDocument());
    expect(screen.getByText('810099•••')).toBeInTheDocument();
  });

  it('exports every UPC group to CSV', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await screen.findByText('810082•••');
    await user.click(screen.getByRole('button', { name: /Export CSV/i }));

    const [filename, headers, rows] = downloadCSV.mock.calls[0];
    expect(filename).toContain('upc-catalog');
    expect(headers[0]).toBe('UPC prefix');
    expect(rows.map(r => r[0])).toEqual(['810082', '810099']);
  });

  it('loads the items under a prefix when expanded', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await user.click(await screen.findByText('810082•••'));
    expect(await screen.findByText('810082001')).toBeInTheDocument();
    expect(global.fetch.mock.calls.at(-1)[0]).toContain('prefix=810082');
  });

  it('prompts for a first pull when nothing is cached', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => EMPTY }));
    render(<CatalogPanel />);
    expect(await screen.findByRole('button', { name: /Pull catalog from POS/i })).toBeInTheDocument();
    expect(screen.getByText(/Nothing cached yet/i)).toBeInTheDocument();
  });

  // The loop must page through every store rather than firing one long request.
  it('pages through each store until the sync reports done', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      const u = String(url);
      if (u === '/api/pricebook/catalog/sync') {
        const body = JSON.parse(opts.body);
        calls.push([body.store_id, body.start]);
        const done = body.start >= 200;
        return { ok: true, json: async () => ({ fetched: 200, next_start: done ? null : body.start + 200, done, total: 400 }) };
      }
      return { ok: true, json: async () => CATALOG };
    });

    const user = setup();
    render(<CatalogPanel />);
    await user.click(await screen.findByRole('button', { name: /Refresh from POS/i }));

    await waitFor(() => expect(calls).toEqual([
      ['reno', 0], ['reno', 200], ['troup', 0], ['troup', 200],
    ]));
  });

  it('reports which store a failed sync stopped on', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/pricebook/catalog/sync') {
        return { ok: false, json: async () => ({ error: 'NRS 500' }) };
      }
      return { ok: true, json: async () => CATALOG };
    });

    const user = setup();
    render(<CatalogPanel />);
    await user.click(await screen.findByRole('button', { name: /Refresh from POS/i }));
    expect(await screen.findByText(/Reno: NRS 500/i)).toBeInTheDocument();
  });

  it('surfaces a missing migration as an error, not an empty list', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, json: async () => ({ error: 'Catalog tables are not installed yet — run the add-pricebook-catalog.sql migration.' }),
    }));
    render(<CatalogPanel />);
    expect(await screen.findByText(/add-pricebook-catalog\.sql/i)).toBeInTheDocument();
  });
});
