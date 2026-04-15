export const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fK = (n) => { const a = Math.abs(n||0); if (a >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K'; return fmt(n); };
export const dayLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const weekLabel = (w) => new Date(w + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(y, mo-1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
export const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Register 2 is only used at Bells and Kerens stores.
// Reno, Denison, Troup are single-register.
export function hasRegister2(storeName) {
  if (!storeName) return false;
  const n = storeName.toLowerCase();
  if (n.includes('reno') || n.includes('denison') || n.includes('troup')) return false;
  return n.includes('bells') || n.includes('kerens');
}

export const EXPENSE_CATEGORIES = [
  { id: 'power',         label: 'Power/Electricity',     icon: '💡' },
  { id: 'internet',      label: 'Internet',              icon: '🌐' },
  { id: 'rent',          label: 'Rent',                  icon: '🏠' },
  { id: 'water',         label: 'Water',                 icon: '💧' },
  { id: 'payroll',       label: 'Payroll',               icon: '👥' },
  { id: 'payroll_tax',   label: 'Payroll Tax/Fee',       icon: '📋' },
  { id: 'cc_processing', label: 'Credit Card Processing',icon: '💳' },
  { id: 'pos',           label: 'POS Charges',           icon: '💰' },
  { id: 'maintenance',   label: 'Maintenance',           icon: '🔧' },
  { id: 'supplies',      label: 'Supplies',              icon: '📦' },
  { id: 'food_gas',      label: 'Food/Gas',              icon: '🍔' },
];

// Helper: anything not in the fixed list is a custom expense row.
export const FIXED_EXPENSE_IDS = new Set(EXPENSE_CATEGORIES.map(c => c.id));

export const PRODUCT_CATEGORIES = [
  'Cigarettes', 'Cigars', 'Vapes/E-Cigs', 'E-Liquid/Juice', 'Rolling Papers',
  'Lighters', 'Glass/Pipes', 'Hookah/Shisha', 'CBD Products',
  'Kratom', 'Novelty Items', 'Snacks/Drinks', 'Phone Accessories', 'Other'
];

// CSV download helper
export function downloadCSV(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Date range presets — kept consistent across every page that has a DateBar.
export function getDateRange(preset) {
  const now = new Date();
  // Use local-date parts so presets match the user's calendar, not UTC.
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const t = iso(now);
  const startOfWeek = (date) => {
    const d = new Date(date); const dy = d.getDay();
    d.setDate(d.getDate() - dy + (dy === 0 ? -6 : 1));
    return d;
  };

  switch (preset) {
    case 'today':
      return { start: t, end: t };
    case 'yesterday': {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return { start: iso(d), end: iso(d) };
    }
    case 'thisweek': {
      const s = startOfWeek(new Date());
      return { start: iso(s), end: t };
    }
    case 'lastweek': {
      const d = new Date(); d.setDate(d.getDate() - 7);
      const s = startOfWeek(d);
      const e = new Date(s); e.setDate(e.getDate() + 6);
      return { start: iso(s), end: iso(e) };
    }
    case 'thismonth':
      return { start: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, end: t };
    case 'last2weeks': {
      const d = new Date(); d.setDate(d.getDate() - 14);
      return { start: iso(d), end: t };
    }
    case 'lastmonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(first), end: iso(last) };
    }
    case 'last2months': {
      const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { start: iso(first), end: t };
    }
    case 'last3months': {
      const first = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      return { start: iso(first), end: t };
    }
    case 'last6months': {
      const first = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      return { start: iso(first), end: t };
    }
    case 'last30': {
      const d = new Date(); d.setDate(d.getDate()-30);
      return { start: iso(d), end: t };
    }
    case 'last90': {
      const d = new Date(); d.setDate(d.getDate()-90);
      return { start: iso(d), end: t };
    }
    case 'thisyear':
      return { start: `${now.getFullYear()}-01-01`, end: t };
    case 'lastyear': {
      const y = now.getFullYear() - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    case 'all': return { start: '2020-01-01', end: t };
    default: return { start: '2020-01-01', end: t };
  }
}

// Given a date range, compute the immediately-previous range of equal length
// for period-over-period comparisons.
export function previousRange(range) {
  const s = new Date(range.start + 'T00:00:00');
  const e = new Date(range.end + 'T00:00:00');
  const days = Math.round((e - s) / 86400000) + 1;
  const prevEnd = new Date(s); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1));
  const iso = (d) => d.toISOString().split('T')[0];
  return { start: iso(prevStart), end: iso(prevEnd) };
}
