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
    { prefix: '81020387', upc_count: 12, store_count: 2, sample_name: 'Geekbar Pulse', min_cents: 2299, max_cents: 2399 },
    { prefix: '810099', upc_count: 4, store_count: 2, sample_name: 'Raz TN9000', min_cents: 1999, max_cents: 1999 },
  ],
  totalGroups: 2,
};

const row = (n, cents) => ({
  upc: `81020387${String(n).padStart(4, '0')}`,
  name: 'Geekbar',
  names: {}, costs: {}, nameConflict: false,
  prices: { reno: cents, troup: cents },
});

// Pulse at 0100-0200 and again at 0301-0500, Pulse X wedged at 0201-0300.
const ITEMS = {
  prefix: '81020387',
  stores: STORES,
  rows: [
    row(100, 2499), row(150, 2499), row(200, 2499),
    row(201, 2999), row(300, 2999),
    row(301, 2499), row(500, 2499),
  ],
  truncated: false,
};

const EMPTY = { ...CATALOG, groups: [], totalGroups: 0, syncStatus: STORES.map(s => ({ store_id: s.id, name: s.name, items: 0, last_synced: null })) };

// The apply is followed by refresh GETs, so locate the write by URL.
const postedWrites = () => {
  const call = global.fetch.mock.calls.find(c => String(c[0]) === '/api/pricebook/bulk-update');
  return JSON.parse(call[1].body).writes;
};

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
    expect(await screen.findByText('81020387•••')).toBeInTheDocument();
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
    await screen.findByText('81020387•••');
    await user.selectOptions(screen.getAllByRole('combobox')[0], '8');
    await waitFor(() => expect(global.fetch.mock.calls.at(-1)[0]).toContain('prefix_len=8'));
  });

  it('filters by UPC prefix', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await screen.findByText('81020387•••');
    await user.type(screen.getByPlaceholderText(/Filter by UPC prefix or name/i), '810099');
    await waitFor(() => expect(screen.queryByText('81020387•••')).not.toBeInTheDocument());
    expect(screen.getByText('810099•••')).toBeInTheDocument();
  });

  it('exports every UPC group to CSV', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await screen.findByText('81020387•••');
    await user.click(screen.getByRole('button', { name: /Export CSV/i }));

    const [filename, headers, rows] = downloadCSV.mock.calls[0];
    expect(filename).toContain('upc-catalog');
    expect(headers[0]).toBe('UPC prefix');
    expect(rows.map(r => r[0])).toEqual(['81020387', '810099']);
  });

  it('loads the items under a prefix when expanded', async () => {
    const user = setup();
    render(<CatalogPanel />);
    await user.click(await screen.findByText('81020387•••'));
    expect(await screen.findByText('$24.99')).toBeInTheDocument();
    expect(global.fetch.mock.calls.at(-1)[0]).toContain('prefix=81020387');
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

  // The whole point: UPC numbering can't separate Pulse from Pulse X, but the
  // price they currently sell at can.
  describe('price buckets', () => {
    const expand = async (user) => {
      render(<CatalogPanel />);
      await user.click(await screen.findByText('81020387•••'));
      await screen.findByText('$24.99');
    };

    it('splits one UPC prefix into its current price points', async () => {
      await expand(setup());
      expect(screen.getByText('$24.99')).toBeInTheDocument();
      expect(screen.getByText('$29.99')).toBeInTheDocument();
      expect(screen.getByText('5 UPCs')).toBeInTheDocument();
      expect(screen.getByText('2 UPCs')).toBeInTheDocument();
    });

    it('shows the non-contiguous blocks a product occupies', async () => {
      await expand(setup());
      expect(screen.getByText('0100-0200, 0301-0500')).toBeInTheDocument();
      expect(screen.getByText('0201-0300')).toBeInTheDocument();
    });

    it('reprices a whole price group in one box', async () => {
      const user = setup();
      await expand(user);
      await user.type(screen.getByLabelText(/New price for the \$24\.99 group/i), '25.99');

      // 5 UPCs x 2 stores, and Pulse X untouched.
      expect(await screen.findByRole('button', { name: /Apply 10 changes/i })).toBeInTheDocument();
    });

    it('leaves the other price group alone', async () => {
      const user = setup();
      await expand(user);
      await user.type(screen.getByLabelText(/New price for the \$24\.99 group/i), '25.99');
      await user.click(await screen.findByRole('button', { name: /Apply 10 changes/i }));

      const writes = postedWrites();
      expect(writes).toHaveLength(10);
      expect(writes.every(w => w.cents === 2599)).toBe(true);
      expect(writes.some(w => w.upc === '810203870201')).toBe(false);
    });

    it('lets one UPC override its group price', async () => {
      const user = setup();
      await expand(user);
      await user.type(screen.getByLabelText(/New price for the \$24\.99 group/i), '25.99');
      await user.click(screen.getByText('$24.99'));
      await user.type(await screen.findByLabelText(/New price for 810203870100/i), '27.99');
      await user.click(await screen.findByRole('button', { name: /Apply 10 changes/i }));

      const writes = postedWrites();
      const overridden = writes.filter(w => w.upc === '810203870100');
      expect(overridden).toHaveLength(2);
      expect(overridden.every(w => w.cents === 2799)).toBe(true);
      expect(writes.filter(w => w.upc === '810203870150').every(w => w.cents === 2599)).toBe(true);
    });
  });

  // The five-store grid is the part that breaks on a phone.
  describe('on a phone', () => {
    beforeEach(() => {
      window.matchMedia = (q) => ({
        matches: true, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
      });
    });
    afterEach(() => {
      window.matchMedia = (q) => ({
        matches: false, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
      });
    });

    it('replaces the wide table with per-item cards', async () => {
      const user = setup();
      render(<CatalogPanel />);
      await user.click(await screen.findByText('81020387•••'));
      await user.click(await screen.findByText('$24.99'));

      expect(await screen.findByLabelText(/New price for 810203870100/i)).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('can still reprice a whole price group', async () => {
      const user = setup();
      render(<CatalogPanel />);
      await user.click(await screen.findByText('81020387•••'));
      await user.type(screen.getByLabelText(/New price for the \$24\.99 group/i), '25.99');

      expect(await screen.findByRole('button', { name: /Apply 10 changes/i })).toBeInTheDocument();
    });
  });
});
