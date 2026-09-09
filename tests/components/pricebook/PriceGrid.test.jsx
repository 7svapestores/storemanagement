import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PriceGrid from '@/components/pricebook/PriceGrid';

const STORES = [
  { id: 'reno', name: 'Reno' }, { id: 'troup', name: 'Troup' },
  { id: 'bells', name: 'Bells' }, { id: 'denison', name: 'Denison' },
  { id: 'kerens', name: 'Kerens' },
];

const ROWS = [{
  upc: '810203870108',
  name: 'Geekbar Pulse Watermelon',
  variant: 'WATERMELON',
  nameConflict: false,
  // Denison deliberately higher; Bells doesn't carry it.
  prices: { reno: 2499, troup: 2499, denison: 2599, kerens: 2499 },
}];

// tests/setup.js stubs matchMedia to always report no match (desktop).
function setViewport({ mobile }) {
  window.matchMedia = (query) => ({
    matches: mobile, media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
  });
}

const base = {
  rows: ROWS, stores: STORES, targetStores: STORES.map(s => s.id),
  rowValue: () => '', onRowChange: vi.fn(), rowPlaceholder: () => '24.99',
};

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

afterEach(() => { setViewport({ mobile: false }); });

describe('<PriceGrid /> — desktop', () => {
  beforeEach(() => setViewport({ mobile: false }));

  it('lays the stores out as table columns', () => {
    render(<PriceGrid {...base} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    for (const s of STORES) {
      expect(screen.getByRole('columnheader', { name: s.name })).toBeInTheDocument();
    }
  });
});

describe('<PriceGrid /> — mobile', () => {
  beforeEach(() => setViewport({ mobile: true }));

  // Five stores plus a name and UPC cannot fit across a phone.
  it('drops the table and shows the stores as labelled pairs', () => {
    render(<PriceGrid {...base} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    for (const s of STORES) expect(screen.getByText(s.name)).toBeInTheDocument();
  });

  it('still shows every store’s price', () => {
    render(<PriceGrid {...base} />);
    expect(screen.getAllByText('$24.99')).toHaveLength(3);
    expect(screen.getByText('$25.99 ⚑')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // Bells
  });

  it('keeps one price box per item, not one per layout', () => {
    render(<PriceGrid {...base} />);
    expect(screen.getAllByLabelText('New price for 810203870108')).toHaveLength(1);
  });

  it('types into the item price box', async () => {
    const onRowChange = vi.fn();
    const user = setup();
    render(<PriceGrid {...base} onRowChange={onRowChange} />);
    await user.type(screen.getByLabelText('New price for 810203870108'), '2');
    expect(onRowChange).toHaveBeenCalledWith('810203870108', '2');
  });

  it('offers a per-store box when cell editing is enabled', async () => {
    const onCellChange = vi.fn();
    const user = setup();
    render(<PriceGrid {...base} cellValue={() => ''} onCellChange={onCellChange} />);

    const denison = screen.getByLabelText('Denison price for 810203870108');
    await user.type(denison, '9');
    expect(onCellChange).toHaveBeenCalledWith('denison', '810203870108', '9');
  });

  it('marks an unreachable store apart from one that does not carry the item', () => {
    render(<PriceGrid {...base} unreachableStores={new Set(['Kerens'])} />);
    expect(screen.getByTitle('Kerens could not be reached')).toHaveTextContent('?');
    expect(screen.getByTitle('Bells does not carry this item')).toHaveTextContent('—');
  });

  it('flags a store holding its own price', () => {
    render(<PriceGrid {...base} />);
    expect(screen.getByTitle(/Denison has its own price/)).toBeInTheDocument();
  });

  // On its own meta line, not wrapped into the middle of the product name.
  it('surfaces a name that differs between stores', () => {
    render(<PriceGrid {...base} rows={[{ ...ROWS[0], nameConflict: true }]} />);
    expect(screen.getByText(/name differs by store/i)).toBeInTheDocument();
  });
});

describe('<PriceGrid /> — reacting to rotation', () => {
  it('re-lays-out when the viewport crosses the breakpoint', () => {
    const listeners = [];
    let matches = false;
    window.matchMedia = (query) => ({
      // A getter, so the hook reads the value at the moment it is called
      // rather than whatever it was when the object was built.
      get matches() { return matches; },
      media: query,
      addEventListener: (_e, fn) => listeners.push(fn),
      removeEventListener: () => {},
    });

    render(<PriceGrid {...base} />);
    expect(screen.getByRole('table')).toBeInTheDocument();

    matches = true;
    act(() => listeners.forEach(fn => fn()));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// globals.css:149 sets `width: 100%` on every untyped input and select. Any
// width here must be marked important or the box fills its row and squeezes
// the item name to one word per line — which is exactly what shipped.
describe('<PriceGrid /> — price boxes resist the global input width', () => {
  for (const mobile of [false, true]) {
    it(`marks the item price box width important (${mobile ? 'mobile' : 'desktop'})`, () => {
      setViewport({ mobile });
      render(<PriceGrid {...base} />);
      const input = screen.getByLabelText('New price for 810203870108');
      expect(input.className).toMatch(/!w-/);
    });

    it(`marks the per-store price box width important (${mobile ? 'mobile' : 'desktop'})`, () => {
      setViewport({ mobile });
      render(<PriceGrid {...base} cellValue={() => ''} onCellChange={vi.fn()} />);
      const input = screen.getByLabelText('Reno price for 810203870108');
      expect(input.className).toMatch(/!w-/);
    });
  }
});

// "7s Vape Love - Reno" truncates to "7s Vape Love …" in a narrow column,
// which makes every store look identical.
describe('<PriceGrid /> — store labels', () => {
  const LONG = [
    { id: 'reno', name: '7s Vape Love - Reno' },
    { id: 'bells', name: '7s Smoke and Vape World - Bells' },
  ];
  const longBase = {
    ...base,
    stores: LONG,
    targetStores: LONG.map(s => s.id),
    rows: [{ ...ROWS[0], prices: { reno: 2499, bells: 2499 } }],
  };

  for (const mobile of [false, true]) {
    it(`shows the distinguishing part of the store name (${mobile ? 'mobile' : 'desktop'})`, () => {
      setViewport({ mobile });
      render(<PriceGrid {...longBase} />);
      expect(screen.getByText('Reno')).toBeInTheDocument();
      expect(screen.getByText('Bells')).toBeInTheDocument();
      expect(screen.queryByText('7s Vape Love - Reno')).not.toBeInTheDocument();
    });
  }

  it('keeps the full name available on hover', () => {
    setViewport({ mobile: true });
    render(<PriceGrid {...longBase} />);
    expect(screen.getByTitle('7s Vape Love - Reno')).toBeInTheDocument();
  });
});

describe('<PriceGrid /> — long product names', () => {
  it('renders the whole name rather than letting the price box crowd it', () => {
    setViewport({ mobile: true });
    const long = { ...ROWS[0], variant: null, name: 'Geek Bar Pulse Mexico Mango 15k' };
    render(<PriceGrid {...base} rows={[long]} />);
    expect(screen.getByText('Geek Bar Pulse Mexico Mango 15k')).toBeInTheDocument();
  });
});
