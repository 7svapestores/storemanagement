'use client';
import { useState, useEffect, useRef } from 'react';
import { fmt, fK, weekLabel, getDateRange } from '@/lib/utils';

// ── SmartDatePicker ─────────────────────────────────────────
// Three dropdown selects (Month / Day / Year) + a native date fallback icon.
// Props: value (YYYY-MM-DD string), onChange (YYYY-MM-DD string => void)
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
const pad2 = n => String(n).padStart(2, '0');
const curYear = new Date().getFullYear();

export function SmartDatePicker({ value, onChange }) {
  const parse = (v) => {
    if (!v) { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
    const [y, m, d] = String(v).split('-').map(Number);
    return { y: y || curYear, m: m || 1, d: d || 1 };
  };
  const { y, m, d: day } = parse(value);
  const nativeRef = useRef(null);

  const emit = (ny, nm, nd) => {
    const maxDay = daysInMonth(nm, ny);
    const safeDay = Math.min(nd, maxDay);
    onChange(`${ny}-${pad2(nm)}-${pad2(safeDay)}`);
  };

  const maxDays = daysInMonth(m, y);
  const yearStart = curYear - 2;
  const yearEnd = curYear + 1;

  const selStyle = {
    background: '#131C28', border: '1px solid #1A2536', borderRadius: 8,
    color: '#E2E8F0', fontSize: 13, padding: '9px 8px', minHeight: 44,
    outline: 'none', flex: 1, minWidth: 0, cursor: 'pointer',
  };

  return (
    <div className="flex gap-1.5 items-center">
      <select
        value={m}
        onChange={e => emit(y, Number(e.target.value), day)}
        style={{ ...selStyle, minWidth: 110 }}
      >
        {MONTHS.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
      </select>
      <select
        value={Math.min(day, maxDays)}
        onChange={e => emit(y, m, Number(e.target.value))}
        style={selStyle}
      >
        {Array.from({ length: maxDays }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
      </select>
      <select
        value={y}
        onChange={e => emit(Number(e.target.value), m, day)}
        style={{ ...selStyle, minWidth: 80 }}
      >
        {Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => {
          const yr = yearStart + i;
          return <option key={yr} value={yr}>{yr}</option>;
        })}
      </select>
      <button
        type="button"
        onClick={() => nativeRef.current?.showPicker?.()}
        title="Open calendar"
        style={{ background: '#131C28', border: '1px solid #1A2536', borderRadius: 8, minHeight: 44, width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
      >
        📅
      </button>
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        onChange={e => { if (e.target.value) onChange(e.target.value); }}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
        tabIndex={-1}
      />
    </div>
  );
}

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
// Dropdown that lets the user toggle many options at once. Styling is done
// with inline styles for the checkbox cell + panel so it renders consistently
// regardless of tailwind purge state.
//
// props:
//   options: [{ value, label, icon? }]
//   value: array of selected values (controlled)
//   onChange: (newArray) => void
//   placeholder: string shown when nothing is selected
//   label: short uppercase label on the left (optional)
//   unitLabel: singular noun used in summary ("store", "vendor")
export function MultiSelect({ options, value = [], onChange, placeholder = 'All', label, unitLabel = 'selected', className = '' }) {
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

  // Render the trigger content. When ≤3 chips, show them. Otherwise collapse
  // to "N <unit>s selected" so the trigger doesn't grow unbounded.
  const triggerContent = () => {
    if (value.length === 0) {
      return <span style={{ color: '#64748B', fontSize: 11 }}>{placeholder}</span>;
    }
    if (value.length > 3) {
      return (
        <span style={{ color: '#60A5FA', fontSize: 11, fontWeight: 600 }}>
          {value.length} {unitLabel}{value.length === 1 ? '' : 's'} selected
        </span>
      );
    }
    return value.map(v => {
      const opt = options.find(o => o.value === v);
      return (
        <span
          key={v}
          onClick={(e) => { e.stopPropagation(); toggle(v); }}
          title="Remove"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'rgba(59,130,246,0.15)', color: '#60A5FA',
            border: '1px solid rgba(59,130,246,0.4)', borderRadius: 4,
            padding: '2px 6px', fontSize: 10, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {opt?.icon ? `${opt.icon} ` : ''}{opt?.label || v}
          <span style={{ color: 'rgba(96,165,250,0.7)' }}>✕</span>
        </span>
      );
    });
  };

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      {label && (
        <label style={{ color: '#64748B', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: '#131C28',
          border: '1px solid #1A2536',
          borderRadius: 8,
          padding: '6px 10px',
          minHeight: 36,
          minWidth: 200,
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          color: '#E2E8F0',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {triggerContent()}
        <span style={{ marginLeft: 'auto', color: '#64748B', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 4,
            zIndex: 50,
            background: '#131C28',
            border: '1px solid #1A2536',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            minWidth: 240,
            maxHeight: 300,
            overflow: 'auto',
            padding: '4px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid #1A2536',
              position: 'sticky',
              top: 0,
              background: '#131C28',
            }}
          >
            <button
              type="button"
              onClick={selectAll}
              style={{ background: 'transparent', border: 0, color: '#60A5FA', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearAll}
              style={{ background: 'transparent', border: 0, color: '#64748B', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}
            >
              Clear
            </button>
          </div>
          {options.map(o => {
            const active = selectedSet.has(o.value);
            return (
              <div
                key={o.value}
                onClick={() => toggle(o.value)}
                role="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                  color: active ? '#93C5FD' : '#E2E8F0',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'background 120ms',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#1A2536'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    minWidth: 20,
                    border: `2px solid ${active ? '#3B82F6' : '#6B7280'}`,
                    borderRadius: 4,
                    background: active ? '#3B82F6' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {active && <span style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.icon ? `${o.icon} ` : ''}{o.label}
                </span>
              </div>
            );
          })}
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', color: '#64748B', fontSize: 11 }}>No options</div>
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

// ── Sort Dropdown ───────────────────────────────────────────
// A simple <select> that mirrors/drives DataTable sort state.
// props:
//   options: [{ label: 'Date (newest)', key: 'date', dir: 'desc' }, ...]
//   value: { key, dir } — current sort state
//   onChange: ({ key, dir }) => void
export function SortDropdown({ options, value, onChange }) {
  const selected = options.findIndex(o => o.key === value?.key && o.dir === value?.dir);
  return (
    <div className="inline-flex items-center gap-2">
      <label className="text-sw-sub text-[10px] font-bold uppercase">Sort</label>
      <select
        value={selected >= 0 ? selected : ''}
        onChange={e => {
          const idx = Number(e.target.value);
          if (!isNaN(idx) && options[idx]) onChange({ key: options[idx].key, dir: options[idx].dir });
        }}
        className="!w-auto !min-w-[180px] !py-1.5 !text-[11px]"
      >
        {selected < 0 && <option value="">Custom</option>}
        {options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
      </select>
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
export function DataTable({ columns, rows, onEdit, onDelete, isOwner = true, emptyMessage = 'No data', defaultSort, sortState, onSortChange }) {
  const [internalSort, setInternalSort] = useState(defaultSort || null);
  const sort = sortState !== undefined ? sortState : internalSort;
  const setSort = (v) => {
    const next = typeof v === 'function' ? v(sort) : v;
    setInternalSort(next);
    onSortChange?.(next);
  };
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
      let cmp;
      if (typeof av === 'number' && typeof bv === 'number') cmp = (av - bv) * dir;
      else cmp = String(av).localeCompare(String(bv)) * dir;
      if (cmp !== 0) return cmp;
      const ad = a.date || a.week_of || a.month || '';
      const bd = b.date || b.week_of || b.month || '';
      return bd.localeCompare(ad);
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

// ── Store Pills — horizontal pill row: [All Stores] [• Bells] [• Kerens] … ──
// Single-select. Clicking the active pill again unselects (returns to All).
// Pass `showAll={false}` to hide the All Stores pill.
export function StorePills({ stores = [], value = '', onChange, showAll = true, className = '' }) {
  const pillBase = 'px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors';
  const inactive = 'bg-[var(--bg-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)]';
  return (
    <div className={`flex gap-1.5 overflow-x-auto mb-3 pb-1 ${className}`} style={{ WebkitOverflowScrolling: 'touch' }}>
      {showAll && (
        <button
          type="button"
          onClick={() => onChange?.('')}
          className={`${pillBase} ${!value ? 'text-white shadow-sm' : inactive}`}
          style={!value ? { background: 'var(--brand-primary)' } : undefined}
        >
          All Stores
        </button>
      )}
      {stores.map(s => {
        const selected = value === s.id;
        const short = s.name?.split(' - ').pop()?.trim() || s.name;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange?.(selected ? '' : s.id)}
            className={`${pillBase} flex items-center gap-1.5 ${selected ? 'text-white shadow-sm' : inactive}`}
            style={selected ? { background: s.color || 'var(--brand-primary)' } : undefined}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            {short}
          </button>
        );
      })}
    </div>
  );
}
