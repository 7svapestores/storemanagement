'use client';
import { useState } from 'react';
import { fmt, fK, weekLabel, getDateRange } from '@/lib/utils';

// ── Stat Card ───────────────────────────────────────────────
export function StatCard({ label, value, sub, color, icon }) {
  return (
    <div className="bg-sw-card rounded-xl p-4 border border-sw-border flex-1 min-w-[150px]">
      <div className="flex justify-between mb-2">
        <span className="text-sw-sub text-[10px] font-bold uppercase tracking-wide">{label}</span>
        <span className="text-[15px]">{icon}</span>
      </div>
      <div className="text-[22px] font-extrabold font-mono" style={{ color: color || '#E2E8F0' }}>{value}</div>
      {sub && <div className="text-sw-sub text-[11px] mt-1">{sub}</div>}
    </div>
  );
}

// ── Date Preset Buttons ─────────────────────────────────────
export function DatePresets({ active, onChange }) {
  const presets = [
    { id: 'thisweek', l: 'This Week' }, { id: 'lastweek', l: 'Last Week' },
    { id: 'thismonth', l: 'This Month' }, { id: 'last30', l: '30 Days' },
    { id: 'last90', l: '90 Days' }, { id: 'all', l: 'All' },
  ];
  return (
    <div className="flex gap-1 flex-wrap">
      {presets.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors
            ${active === p.id ? 'bg-sw-blueD text-sw-blue border border-sw-blue/20' : 'bg-sw-card2 text-sw-sub border border-sw-border hover:text-sw-text'}`}>
          {p.l}
        </button>
      ))}
    </div>
  );
}

// ── Date Filter Bar ─────────────────────────────────────────
export function DateBar({ preset, onPreset, startDate, endDate, onStartChange, onEndChange }) {
  return (
    <div className="bg-sw-card rounded-lg p-2.5 border border-sw-border mb-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <DatePresets active={preset} onChange={onPreset} />
        <div className="flex gap-1.5 items-center">
          <input type="date" value={startDate} onChange={e => onStartChange(e.target.value)} className="!w-[130px] !py-1 !px-2 !text-[11px]" />
          <span className="text-sw-dim text-xs">→</span>
          <input type="date" value={endDate} onChange={e => onEndChange(e.target.value)} className="!w-[130px] !py-1 !px-2 !text-[11px]" />
        </div>
      </div>
    </div>
  );
}

// ── useDateRange hook ───────────────────────────────────────
export function useDateRange(defaultPreset = 'last30') {
  const [preset, setPreset] = useState(defaultPreset);
  const [custom, setCustom] = useState({ start: '', end: '' });

  const range = preset === 'custom' ? custom : getDateRange(preset);

  const selectPreset = (p) => setPreset(p);
  const setStart = (s) => { setPreset('custom'); setCustom(prev => ({ ...prev, start: s })); };
  const setEnd = (e) => { setPreset('custom'); setCustom(prev => ({ ...prev, end: e })); };

  return { range, preset, selectPreset, setStart, setEnd };
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className={`relative bg-sw-card rounded-2xl p-6 border border-sw-border max-h-[88vh] overflow-auto
          ${wide ? 'max-w-[700px]' : 'max-w-[480px]'} w-full`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sw-text text-base font-bold">{title}</h3>
          <button onClick={onClose} className="text-sw-dim hover:text-sw-text text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
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
      className={`px-4 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${styles[variant]} ${className}`}
      style={variant === 'primary' ? { background: 'linear-gradient(135deg, #60A5FA, #93C5FD)' } : {}}>
      {children}
    </button>
  );
}

// ── Data Table ──────────────────────────────────────────────
export function DataTable({ columns, rows, onEdit, onDelete, isOwner = true }) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: c.align || 'left' }}>{c.label}</th>
            ))}
            {(onEdit || onDelete) && isOwner && <th style={{ width: 60 }} />}
          </tr>
        </thead>
        <tbody>
          {!rows?.length && (
            <tr><td colSpan={columns.length + ((onEdit || onDelete) && isOwner ? 1 : 0)} className="!text-center !py-8 !text-sw-dim">No data</td></tr>
          )}
          {rows?.slice(0, 100).map((row, i) => (
            <tr key={row.id || i}>
              {columns.map(c => (
                <td key={c.key} style={{ textAlign: c.align || 'left', fontFamily: c.mono ? "'IBM Plex Mono', monospace" : 'inherit' }}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
              {(onEdit || onDelete) && isOwner && (
                <td className="!whitespace-nowrap">
                  {onEdit && <button onClick={() => onEdit(row)} className="text-sw-blue text-[11px] mr-1.5 hover:underline">✎</button>}
                  {onDelete && <button onClick={() => onDelete(row.id)} className="text-sw-dim text-[11px] hover:text-sw-red">✕</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
    <div className="flex justify-between items-center mb-3.5">
      <div>
        <h1 className="text-sw-text text-[22px] font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="text-sw-sub text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-1.5">{children}</div>}
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
