export const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fK = (n) => { const a = Math.abs(n||0); if (a >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M'; if (a >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K'; return fmt(n); };
export const dayLabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const weekLabel = (w) => new Date(w + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const monthLabel = (m) => { const [y, mo] = m.split('-'); return new Date(y, mo-1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
export const today = () => new Date().toISOString().split('T')[0];

export const EXPENSE_CATEGORIES = [
  { id: 'power', label: 'Power', icon: '⚡' },
  { id: 'rent', label: 'Rent', icon: '🏠' },
  { id: 'internet', label: 'Internet', icon: '🌐' },
  { id: 'pos', label: 'POS Charges', icon: '💳' },
  { id: 'ccfee', label: 'CC Fee', icon: '💰' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'insurance', label: 'Insurance', icon: '🛡️' },
  { id: 'license', label: 'License/Permit', icon: '📜' },
  { id: 'security', label: 'Security', icon: '🔒' },
  { id: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { id: 'other', label: 'Other', icon: '📋' },
];

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

// Date range presets
export function getDateRange(preset) {
  const t = today();
  const now = new Date();
  switch (preset) {
    case 'thisweek': {
      const d = new Date(); const dy = d.getDay();
      d.setDate(d.getDate() - dy + (dy === 0 ? -6 : 1));
      const s = d.toISOString().split('T')[0];
      const e = new Date(d); e.setDate(e.getDate() + 6);
      return { start: s, end: e.toISOString().split('T')[0] };
    }
    case 'lastweek': {
      const d = new Date(); d.setDate(d.getDate() - 7);
      const dy = d.getDay(); d.setDate(d.getDate() - dy + (dy === 0 ? -6 : 1));
      const s = d.toISOString().split('T')[0];
      const e = new Date(d); e.setDate(e.getDate() + 6);
      return { start: s, end: e.toISOString().split('T')[0] };
    }
    case 'thismonth':
      return { start: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, end: t };
    case 'last30': {
      const d = new Date(); d.setDate(d.getDate()-30);
      return { start: d.toISOString().split('T')[0], end: t };
    }
    case 'last90': {
      const d = new Date(); d.setDate(d.getDate()-90);
      return { start: d.toISOString().split('T')[0], end: t };
    }
    case 'all': return { start: '2020-01-01', end: t };
    default: return { start: '2020-01-01', end: t };
  }
}
