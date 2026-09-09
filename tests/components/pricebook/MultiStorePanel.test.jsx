import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiStorePanel from '@/components/pricebook/MultiStorePanel';

const STORES = [
  { id: 'reno', name: 'Reno' },
  { id: 'troup', name: 'Troup' },
  { id: 'denison', name: 'Denison' },
];

// Denison deliberately sits $1 above the other two on Watermelon.
const MATRIX = {
  query: 'geekbar',
  stores: STORES,
  unavailable: [],
  variantDigits: 3,
  totalItems: 2,
  families: [{
    key: '9:810082',
    label: 'GEEKBAR PULSE',
    upcPrefix: '810082',
    variantDigits: 3,
    items: [
      {
        upc: '810082001', name: 'Geekbar Pulse Watermelon', variant: 'WATERMELON',
        names: {}, costs: {}, nameConflict: false,
        prices: { reno: 2299, troup: 2299, denison: 2399 },
      },
      {
        upc: '810082002', name: 'Geekbar Pulse Blue Razz', variant: 'BLUE RAZZ',
        names: {}, costs: {}, nameConflict: false,
        prices: { reno: 2299, troup: 2299, denison: 2299 },
      },
    ],
  }],
};

const jsonOnce = (body, ok = true) =>
  global.fetch.mockResolvedValueOnce({ ok, json: async () => body });

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

async function searchFor(user, term = 'geekbar', matrix = MATRIX) {
  jsonOnce(matrix);
  await user.type(screen.getByPlaceholderText(/Search every store/i), term);
  await user.click(screen.getByRole('button', { name: /Search all stores/i }));
  await screen.findByText('GEEKBAR PULSE');
}

const familyBox = () => screen.getByPlaceholderText('24.99');

beforeEach(() => { global.fetch = vi.fn(); });

describe('<MultiStorePanel />', () => {
  it('searches every store through the matrix endpoint', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/pricebook/matrix?q=geekbar');
  });

  it('shows each store as a column with its own price', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    for (const s of STORES) expect(screen.getByRole('columnheader', { name: s.name })).toBeInTheDocument();
    // Denison's differing price is rendered as that cell's placeholder.
    expect(screen.getByPlaceholderText('23.99')).toBeInTheDocument();
  });

  it('does not search on a one-character term', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await user.type(screen.getByPlaceholderText(/Search every store/i), 'g');
    await user.click(screen.getByRole('button', { name: /Search all stores/i }));
    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // The core promise: one price, every store, minus the deliberate outlier.
  it('a family price stages every store except the deliberately different one', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);

    await user.type(familyBox(), '24.99');
    // Watermelon: Reno + Troup (Denison protected). Blue Razz: all three.
    expect(screen.getByText(/1 store protected/i)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));
    expect(await screen.findByRole('button', { name: /Apply 5 changes/i })).toBeInTheDocument();
  });

  it('explains in the review which store was left alone and why', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    await user.type(familyBox(), '24.99');
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));

    expect(await screen.findByText(/deliberately different/i)).toBeInTheDocument();
    expect(screen.getByText(/staying at \$23\.99/i)).toBeInTheDocument();
  });

  it('includes the protected store once the owner ticks it in', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    await user.type(familyBox(), '24.99');
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));
    await user.click(await screen.findByLabelText(/Change these too/i));

    expect(await screen.findByRole('button', { name: /Apply 6 changes/i })).toBeInTheDocument();
  });

  it('only writes the stores that are ticked', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    await user.click(screen.getByRole('button', { name: /Troup/ })); // untick
    await user.type(familyBox(), '24.99');
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));

    // Reno on both flavors; Denison only on Blue Razz (Watermelon protected).
    expect(await screen.findByRole('button', { name: /Apply 3 changes/i })).toBeInTheDocument();
  });

  it('posts exactly the reviewed changes to bulk-update', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    await user.type(familyBox(), '24.99');
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));

    jsonOnce({ updated: 5, unchanged: 0, failed: 0, results: [] });
    jsonOnce(MATRIX); // the panel re-searches afterwards
    await user.click(await screen.findByRole('button', { name: /Apply 5 changes/i }));

    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(1));
    const posted = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(posted.writes).toHaveLength(5);
    expect(posted.writes.every(w => w.cents === 2499)).toBe(true);
    expect(posted.writes.find(w => w.store_id === 'denison' && w.upc === '810082001')).toBeUndefined();
  });

  it('reports a per-store failure back to the owner', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    await user.type(familyBox(), '24.99');
    await user.click(await screen.findByRole('button', { name: /Review & apply/i }));

    jsonOnce({
      updated: 4, unchanged: 0, failed: 1,
      results: [{ ok: false, store_id: 'reno', store_name: 'Reno', upc: '810082001', error: 'NRS rejected price update' }],
    });
    jsonOnce(MATRIX);
    await user.click(await screen.findByRole('button', { name: /Apply 5 changes/i }));

    // The summary has to survive the price refresh that follows an apply.
    expect(await screen.findByText(/NRS rejected price update/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
  });

  // A store that errored must not read as a store that doesn't stock the item.
  it('marks an unreachable store rather than showing it as not carried', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user, 'geekbar', {
      ...MATRIX,
      unavailable: [{ store: 'Denison', error: 'NRS 500' }],
    });

    expect(screen.getByText(/Could not reach Denison/i)).toBeInTheDocument();
    expect(screen.getAllByTitle('Denison could not be reached').length).toBeGreaterThan(0);
  });

  it('shows nothing to apply until a price is entered', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    expect(screen.queryByRole('button', { name: /Review & apply/i })).not.toBeInTheDocument();
  });

  it('surfaces a search error instead of an empty table', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    jsonOnce({ error: 'Every store failed: NRS down' }, false);
    await user.type(screen.getByPlaceholderText(/Search every store/i), 'geekbar');
    await user.click(screen.getByRole('button', { name: /Search all stores/i }));
    expect(await screen.findByText(/Every store failed: NRS down/i)).toBeInTheDocument();
  });

  it('re-searches with a new flavor-digit setting', async () => {
    const user = setup();
    render(<MultiStorePanel />);
    await searchFor(user);
    jsonOnce({ ...MATRIX, variantDigits: 2 });
    await user.selectOptions(screen.getByRole('combobox'), '2');
    await waitFor(() => expect(global.fetch.mock.calls.at(-1)[0]).toContain('variant_digits=2'));
  });
});
