'use client';
import { useState, useEffect, useRef } from 'react';
import { fmt, fK, weekLabel, getDateRange } from '@/lib/utils';

// ── Stat Card ───────────────────────────────────────────────
export function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="bg-sw-card rounded-xl p-3.5 sm:p-4 border border-sw-border flex-1 basis-full sm:basis-auto min-w-0 sm:min-w-[150px]">
      <div className="flex justify-between mb-2">
        <span className="text-sw-sub text-[10px] font-bold uppercase tracking-wide">{label}</span>
        <span className="text-[15px]">{icon}</span>
      </div>
      <div className="text-[20px] sm:text-[22px] font-extrabold font-mono" style={{ color: color || '#E2E8F0' }}>{value}</div>
      {sub && <div className="text-sw-sub text-[11px] mt-1">{sub}</div>}
    </div>
  );
}

// ── Date Preset Buttons ─────────────────────────────────────
const PRIMARY_PRESETS = [
  { id: 'today',     l: 'Today' },
  { id: 'thisweek',  l: 'This Week' },
  { id: 'thismonth', l: 'This Month' },
  { id: 'lastmonth', l: 'Last Month' },
];

const OVERFLOW_PRESETS = [
  { id: 'yesterday',   l: 'Yesterday' },
  { id: 'lastweek',    l: 'Last Week' },
  { id: 'last2weeks',  l: 'Last 2 Weeks' },
  { id: 'last2months', l: 'Last 2 Months' },
  { id: 'last3months', l: 'Last 3 Months' },
  { id: 'last6months', l: 'Last 6 Months' },
  { id: 'thisyear',    l: 'This Year' },
  { id: 'lastyear',    l: 'Last Year' },
  { id: 'all',         l: 'All Time' },
];

const ALL_PRESETS = [...PRIMARY_PRESETS, ...OVERFLOW_PRESETS];

export function DatePresets({ active, onChange }) {
  const [open, setOpen] = useState(false);
  const activeLabel = ALL_PRESETS.find(p => p.id === active)?.l;
  const activeInOverflow = OVERFLOW_PRESETS.some(p => p.id === active);

  // Structure: a non-overflow `relative` wrapper holds the scrolling preset
  // row AND the "More" button + dropdown. The dropdown escapes any scroll
  // clipping because its ancestor isn't `overflow: auto`.
  return (
    <div className="flex gap-1 items-center relative flex-wrap">
      <div
        className="flex gap-1 md:flex-wrap flex-nowrap overflow-x-auto items-center"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {PRIMARY_PRESETS.map(p => (
          <button key={p.id} onClick={() => onChange(p.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors flex-shrink-0
              ${active === p.id ? 'bg-sw-blueD text-sw-blue border border-sw-blue/20' : 'bg-sw-card2 text-sw-sub border border-sw-border hover:text-sw-text'}`}>
            {p.l}
          </button>
        ))}
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors flex-shrink-0
          ${activeInOverflow ? 'bg-sw-blueD text-sw-blue border border-sw-blue/20' : 'bg-sw-card2 text-sw-sub border border-sw-border hover:text-sw-text'}`}
      >
        {activeInOverflow ? activeLabel : 'More'} ▾
      </button>
      {open && (
        <>
          {/* Tap-outside backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          {/* Dropdown — absolute relative to the non-overflow wrapper */}
          <div className="absolute right-0 top-full mt-1 z-40 bg-sw-card border border-sw-border rounded-lg shadow-lg py-1 min-w-[180px]">
            {OVERFLOW_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`block w-full text-left px-3 py-2 text-[12px] font-semibold transition-colors
                  ${active === p.id ? 'bg-sw-blueD text-sw-blue' : 'text-sw-sub hover:bg-sw-card2 hover:text-sw-text'}`}
              >
                {p.l}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Date Filter Bar ─────────────────────────────────────────
// Native <input type="date"> fires onChange on every keystroke / month nav,
// which can briefly produce nonsense dates (like the 1st of a month the user
// is just navigating through) and trigger a refetch. We hold a local copy of
// the value and debounce the upstream callback by 500ms, so the page only
// refilters once the user has stopped typing/picking. Preset buttons bypass
// the debounce and apply immediately.
export function DateBar({ preset, onPreset, startDate, endDate, onStartChange, onEndChange }) {
  const [localStart, setLocalStart] = useState(startDate);
  const [localEnd, setLocalEnd] = useState(endDate);
  const startTimer = useRef(null);
  const endTimer = useRef(null);

  // Reflect upstream changes (preset clicks, hook init) into the inputs.
  useEffect(() => { setLocalStart(startDate); }, [startDate]);
  useEffect(() => { setLocalEnd(endDate); }, [endDate]);
  useEffect(() => () => {
    if (startTimer.current) clearTimeout(startTimer.current);
    if (endTimer.current) clearTimeout(endTimer.current);
  }, []);

  const handleStart = (val) => {
    setLocalStart(val);
    if (startTimer.current) clearTimeout(startTimer.current);
    startTimer.current = setTimeout(() => onStartChange(val), 500);
  };
  const handleEnd = (val) => {
    setLocalEnd(val);
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => onEndChange(val), 500);
  };
  const flushStart = () => {
    if (startTimer.current) { clearTimeout(startTimer.current); startTimer.current = null; }
    if (localStart !== startDate) onStartChange(localStart);
  };
  const flushEnd = () => {
    if (endTimer.current) { clearTimeout(endTimer.current); endTimer.current = null; }
    if (localEnd !== endDate) onEndChange(localEnd);
  };

  return (
    <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2">
        <DatePresets active={preset} onChange={onPreset} />
        <div className="flex gap-1.5 items-center w-full md:w-auto">
          <input type="date" value={localStart} onChange={e => handleStart(e.target.value)} onBlur={flushStart} className="!flex-1 md:!w-[130px] md:!flex-none" />
          <span className="text-sw-dim text-xs">→</span>
          <input type="date" value={localEnd} onChange={e => handleEnd(e.target.value)} onBlur={flushEnd} className="!flex-1 md:!w-[130px] md:!flex-none" />
        </div>
      </div>
    </div>
  );
}

// ── useDateRange hook ───────────────────────────────────────
// Behavior:
//   - Selecting a preset sets both dates from the preset definition.
//   - Manually editing start or end switches to 'custom' mode and only
//     mutates the field the user touched. The other field is seeded from
//     whatever the preset was showing, so users never see a blank input.
//   - In 'custom' mode no preset button is highlighted.
export function useDateRange(defaultPreset = 'last30') {
  const [preset, setPreset] = useState(defaultPreset);
  const [custom, setCustom] = useState(() => getDateRange(defaultPreset));

  const range = preset === 'custom' ? custom : getDateRange(preset);

  const selectPreset = (p) => {
    setPreset(p);
    if (p !== 'custom') setCustom(getDateRange(p));
  };
  const setStart = (s) => {
    const base = preset === 'custom' ? custom : getDateRange(preset);
    setCustom({ start: s, end: base.end });
    setPreset('custom');
  };
  const setEnd = (e) => {
    const base = preset === 'custom' ? custom : getDateRange(preset);
    setCustom({ start: base.start, end: e });
    setPreset('custom');
  };

  return { range, preset, selectPreset, setStart, setEnd };
}

// ── MultiSelect ─────────────────────────────────────────────
// Dropdown that lets the user toggle many options at once.
// props:
//   options: [{ value, label, icon? }]
//   value: array of selected values
//   onChange: (newArray) => void
//   placeholder: string shown when nothing is selected (e.g. 'All Stores')
//   label: short uppercase label on the left (optional)
export function MultiSelect({ options, value = [], onChange, placeholder = 'All', label, className = '' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = new Set(value);
  const toggle = (v) => {
    if (selectedSet.has(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };
  const selectAll = () => onChange(options.map(o => o.value));
  const clearAll = () => onChange([]);

  return (
    <div ref={wrapRef} className={`relative inline-flex items-center gap-2 ${className}`}>
      {label && <label className="text-sw-sub text-[10px] font-bold uppercase">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="bg-sw-card2 border border-sw-border rounded-lg px-2 py-1.5 text-left min-h-[36px] min-w-[180px] max-w-full flex items-center gap-1 flex-wrap"
      >
        {value.length === 0 ? (
          <span className="text-sw-dim text-[11px]">{placeholder}</span>
        ) : (
          value.map(v => {
            const opt = options.find(o => o.value === v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 bg-sw-blueD text-sw-blue border border-sw-blue/30 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                onClick={(e) => { e.stopPropagation(); toggle(v); }}
                title="Remove"
              >
                {opt?.icon ? `${opt.icon} ` : ''}{opt?.label || v}
                <span className="text-sw-blue/70">✕</span>
              </span>
            );
          })
        )}
        <span className="ml-auto text-sw-dim text-[10px]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 bg-sw-card border border-sw-border rounded-lg shadow-lg min-w-[220px] max-h-[280px] overflow-auto py-1">
          <div className="flex justify-between px-3 py-1.5 border-b border-sw-border sticky top-0 bg-sw-card">
            <button
              type="button"
              onClick={selectAll}
              className="text-sw-blue text-[10px] font-bold uppercase"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-sw-dim text-[10px] font-bold uppercase"
            >
              Clear
            </button>
          </div>
          {options.map(o => {
            const active = selectedSet.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={`w-full text-left px-3 py-2 text-[12px] font-semibold flex items-center gap-2 ${active ? 'bg-sw-blueD text-sw-blue' : 'text-sw-text hover:bg-sw-card2'}`}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${active ? 'bg-sw-blue border-sw-blue text-black' : 'border-sw-border'}`}
                >
                  {active ? '✓' : ''}
                </span>
                <span className="truncate">{o.icon ? `${o.icon} ` : ''}{o.label}</span>
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sw-dim text-[11px]">No options</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trend Chart ─────────────────────────────────────────────
export function TrendChart({ data, height = 170 }) {
  if (!data?.length) return <div className="text-sw-dim text-center py-8 text-sm">No data</div>;
  const mx = Math.max(...data.flatMap(d => [d.purchases || 0, d.sales || 0]), 1);
  const bw = Math.min(24, Math.max(10, 350 / data.length / 2.5));

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-2.5 px-2" style={{ height, justifyContent: data.length <= 6 ? 'center' : 'flex-start', minWidth: data.length > 6 ? data.length * 60 : 'auto' }}>
        {data.map((d, i) => {
          const pH = ((d.purchases || 0) / mx) * (height - 36);
          const sH = ((d.sales || 0) / mx) * (height - 36);
          const loss = (d.diff || d.sales - d.purchases) < 0;
          const diff = d.diff ?? (d.sales || 0) - (d.purchases || 0);
          return (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div className={`text-[9px] font-mono font-bold px-1 rounded ${loss ? 'text-sw-red bg-sw-redD' : 'text-sw-green bg-sw-greenD'}`}>
                {loss ? '' : '+'}{fK(diff)}
              </div>
              <div className="flex items-end gap-0.5">
                <div style={{ width: bw, height: Math.max(pH, 2), borderRadius: '3px 3px 1px 1px', background: loss ? '#F87171bb' : '#FBBF2488' }}
                  title={`Purchases: ${fmt(d.purchases || 0)}`} />
                <div style={{ width: bw, height: Math.max(sH, 2), borderRadius: '3px 3px 1px 1px', background: '#34D39999' }}
                  title={`Sales: ${fmt(d.sales || 0)}`} />
              </div>
              <span className="text-[8px] text-sw-dim">{d.label || weekLabel(d.week)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-4 mt-2">
        <span className="flex items-center gap-1 text-[10px] text-sw-sub"><span className="w-2 h-2 rounded-sm bg-sw-amber" />Purchases</span>
        <span className="flex items-center gap-1 text-[10px] text-sw-sub"><span className="w-2 h-2 rounded-sm bg-sw-green" />Sales</span>
      </div>
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────
export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex md:items-center md:justify-center md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className={`relative bg-sw-card border border-sw-border overflow-auto
          w-full h-full md:h-auto md:max-h-[88vh] md:rounded-2xl rounded-none
          p-5 md:p-6
          ${wide ? 'md:max-w-[700px]' : 'md:max-w-[480px]'}`}>
        <div className="flex justify-between items-center mb-4 sticky top-0 bg-sw-card pt-1 -mt-1 pb-2 -mx-1 px-1">
          <h3 className="text-sw-text text-base font-bold">{title}</h3>
          <button onClick={onClose} className="text-sw-dim hover:text-sw-text text-xl w-10 h-10 flex items-center justify-center -mr-2">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Image Viewer ────────────────────────────────────────────
// Full-screen image modal with a prominent close button. Handles the mobile
// back button via pushState so "back" closes the viewer instead of leaving
// the page.
export function ImageViewer({ src, caption, onClose, downloadName }) {
  useEffect(() => {
    if (!src) return;
    // Push a history entry so the phone's back button just closes the modal.
    try {
      window.history.pushState({ __imageViewer: true }, '');
    } catch {}
    const onPop = () => onClose?.();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      // Undo our pushed history entry on close. If we're closing via popstate
      // the entry is already gone, so guard with a try.
      try { if (window.history.state?.__imageViewer) window.history.back(); } catch {}
    };
  }, [src]);

  if (!src) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      {/* Top bar with close button */}
      <div
        className="flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}
      >
        <div className="text-white text-[13px] font-semibold truncate mr-3">{caption || 'Invoice'}</div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-2xl font-bold flex items-center justify-center flex-shrink-0"
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Image — fills remaining space, centered, pinch-to-zoom on iOS via touch-action */}
      <div
        className="flex-1 flex items-center justify-center px-2 overflow-auto"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt={caption || ''} className="max-w-full max-h-full object-contain" />
      </div>

      {/* Bottom action bar */}
      <div
        className="flex items-center justify-center gap-3 px-4 flex-wrap"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)', paddingTop: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
          className="text-white text-[12px] font-semibold underline underline-offset-2"
        >
          Open original
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await fetch(src, { mode: 'cors' });
              const blob = await r.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = downloadName || 'invoice.jpg';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            } catch (err) {
              console.error('[viewer] download failed, fallback:', err);
              window.open(src, '_blank', 'noopener,noreferrer');
            }
          }}
          className="text-white text-[12px] font-semibold underline underline-offset-2"
        >
          Download
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-lg bg-white text-black text-[13px] font-bold min-h-[44px]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Store Required Modal ────────────────────────────────────
// Shown when the owner tries to add/edit data while "All Stores" is selected.
// Lets them pick a store inline and then proceeds via onSelectStore.
export function StoreRequiredModal({ stores, onSelectStore, onCancel, title = 'Select a Store First', message }) {
  return (
    <Modal title={`⚠️ ${title}`} onClose={onCancel}>
      <p className="text-sw-sub text-[13px] mb-4">
        {message || 'To add new entries, please select a specific store from the dropdown in the sidebar.'}
      </p>
      {/* Desktop / tablet: button grid */}
      <div className="hidden sm:grid grid-cols-1 gap-2 mb-3">
        {stores.map(s => (
          <button
            key={s.id}
            onClick={() => onSelectStore(s)}
            className="flex items-center gap-2 py-2.5 px-3 rounded-lg bg-sw-card2 border border-sw-border hover:border-sw-blue hover:bg-sw-blueD text-left transition-colors min-h-[44px]"
          >
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="text-sw-text text-[13px] font-semibold">Select {s.name}</span>
          </button>
        ))}
      </div>
      {/* Mobile: single dropdown */}
      <div className="sm:hidden mb-3">
        <label className="block text-sw-sub text-[10px] font-bold uppercase mb-1">Choose store</label>
        <select
          defaultValue=""
          onChange={(e) => {
            const s = stores.find(x => x.id === e.target.value);
            if (s) onSelectStore(s);
          }}
        >
          <option value="" disabled>Select a store…</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Confirm Modal ───────────────────────────────────────────
export function ConfirmModal({ title = 'Are you sure?', message, onCancel, onConfirm, confirmLabel = 'Delete', confirmVariant = 'danger' }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sw-sub text-[13px] mb-4">{message}</div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

// ── Field Label ─────────────────────────────────────────────
export function Field({ label, children }) {
  return (
    <div className="mb-3.5">
      <label className="block text-sw-sub text-[10px] font-bold uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Button ──────────────────────────────────────────────────
export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'text-black font-bold border-none',
    secondary: 'bg-transparent text-sw-text border border-sw-border hover:bg-sw-card2',
    danger: 'bg-sw-redD text-sw-red border-none',
    success: 'bg-sw-greenD text-sw-green border-none',
  };
  return (
    <button {...props}
      className={`px-4 py-2.5 md:py-2 rounded-lg text-[13px] cursor-pointer transition-colors min-h-[44px] md:min-h-0 ${styles[variant]} ${className}`}
      style={variant === 'primary' ? { background: 'linear-gradient(135deg, #39FF14, #FF1493)', color: '#0A0A0A', boxShadow: '0 0 18px rgba(57,255,20,0.35)' } : {}}>
      {children}
    </button>
  );
}

// ── Empty State ─────────────────────────────────────────────
export function EmptyState({ icon = '📭', title = 'Nothing here yet', message, action }) {
  return (
    <div className="py-10 px-4 text-center">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="text-sw-text text-sm font-bold mb-1">{title}</div>
      {message && <p className="text-sw-sub text-xs mb-3 max-w-sm mx-auto">{message}</p>}
      {action}
    </div>
  );
}

// ── Data Table ──────────────────────────────────────────────
// Per-column flags:
//   hideOnMobile: true   — hide below 768px
//   sortable: false      — opt out of sort (default is sortable=true)
//   sortValue: (row) => … — custom accessor used when sorting
//
// DataTable props:
//   defaultSort={{ key, dir }} — initial sort state
export function DataTable({ columns, rows, onEdit, onDelete, isOwner = true, emptyMessage = 'No data', defaultSort }) {
  const [sort, setSort] = useState(defaultSort || null);
  const colClass = (c) => c.hideOnMobile ? 'hidden md:table-cell' : '';

  // Sortable when: explicitly opted in via `sortable: true`, OR the key isn't
  // a synthetic `_foo` and the caller hasn't set `sortable: false`.
  const isSortable = (c) => {
    if (c.sortable === true) return true;
    if (c.sortable === false) return false;
    return !c.key?.startsWith('_');
  };

  const sortedRows = (() => {
    if (!sort || !rows) return rows || [];
    const col = columns.find(c => c.key === sort.key);
    if (!col) return rows;
    const accessor = col.sortValue || ((r) => r[sort.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  })();

  const handleSort = (c) => {
    if (!isSortable(c)) return;
    setSort(prev => {
      if (prev?.key === c.key) {
        return { key: c.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key: c.key, dir: 'asc' };
    });
  };

  const visible = sortedRows.slice(0, 100);
  const total = sortedRows.length;

  return (
    <div>
      <div className="overflow-x-auto relative">
        <table>
          <thead>
            <tr>
              {columns.map(c => {
                const active = sort?.key === c.key;
                const sortable = isSortable(c);
                const arrow = active
                  ? (sort.dir === 'asc' ? ' ↑' : ' ↓')
                  : (sortable ? <span className="text-sw-dim/60 ml-0.5">↕</span> : '');
                return (
                  <th
                    key={c.key}
                    className={`${colClass(c)} ${sortable ? 'cursor-pointer select-none hover:!text-sw-text transition-colors' : ''} ${active ? '!text-sw-blue' : ''}`}
                    style={{ textAlign: c.align || 'left' }}
                    onClick={() => handleSort(c)}
                  >
                    {c.label}{typeof arrow === 'string' ? arrow : null}{typeof arrow !== 'string' ? arrow : null}
                  </th>
                );
              })}
              {(onEdit || onDelete) && isOwner && <th style={{ width: 60 }} />}
            </tr>
          </thead>
          <tbody>
            {!visible.length && (
              <tr>
                <td colSpan={columns.length + ((onEdit || onDelete) && isOwner ? 1 : 0)} className="!text-center !py-8 !text-sw-dim">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {visible.map((row, i) => (
              <tr key={row.id || i}>
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={colClass(c)}
                    style={{ textAlign: c.align || 'left', fontFamily: c.mono ? "'IBM Plex Mono', monospace" : 'inherit' }}
                  >
                    {c.render ? c.render(row[c.key], row) : row[c.key]}
                  </td>
                ))}
                {(onEdit || onDelete) && isOwner && (
                  <td className="!whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          className="inline-flex items-center justify-center px-3 rounded-md bg-sw-blueD border border-sw-blue/30 text-sw-blue text-[12px] font-semibold min-h-[32px] md:min-h-[32px]"
                          style={{ minHeight: 32 }}
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(row.id)}
                          className="inline-flex items-center justify-center px-3 rounded-md bg-sw-redD border border-sw-red/30 text-sw-red text-[12px] font-semibold"
                          style={{ minHeight: 32 }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <div className="px-3 py-1.5 text-sw-dim text-[10px] border-t border-sw-border">
          Showing {Math.min(visible.length, 100)} of {total} entries
        </div>
      )}
    </div>
  );
}

// ── Alert Banner ────────────────────────────────────────────
export function Alert({ type = 'info', children }) {
  const styles = {
    success: 'bg-sw-greenD border-sw-green/20 text-sw-green',
    error: 'bg-sw-redD border-sw-red/20 text-sw-red',
    warning: 'bg-sw-amberD border-sw-amber/20 text-sw-amber',
    info: 'bg-sw-blueD border-sw-blue/20 text-sw-blue',
  };
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3.5 py-2 mb-3 border text-[13px] ${styles[type]}`}>
      <span className="text-base">{icons[type]}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

// ── Loading ─────────────────────────────────────────────────
export function Loading({ text = 'Loading...' }) {
  return <div className="py-10 text-center text-sw-dim"><div className="text-3xl mb-3">⏳</div>{text}</div>;
}

// ── Page Header ─────────────────────────────────────────────
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3.5">
      <div>
        <h1 className="text-sw-text text-[20px] sm:text-[22px] font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="text-sw-sub text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-1.5 flex-wrap">{children}</div>}
    </div>
  );
}

// ── Store Color Dot + Name ──────────────────────────────────
export function StoreBadge({ name, color }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: color || '#60A5FA' }} />
      {name}
    </span>
  );
}
