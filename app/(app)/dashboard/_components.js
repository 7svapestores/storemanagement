'use client';
// Dashboard v2 presentation components.
// Pure UI — no data fetching. Business logic lives in the page.
import { useState } from 'react';
import Link from 'next/link';
import { fmt, fK } from '@/lib/utils';

// ─── Sparkline ─────────────────────────────────────────────────
// Inline SVG line chart with gradient fill. Small enough to drop into a
// stat card or a hero. Pass `data` as an array of numbers.
export function Sparkline({ data = [], width = 50, height = 14, color = 'var(--color-success)', fill = true, stroke = 1.5 }) {
  if (!data?.length || data.length < 2) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => [i * step, height - ((v - min) / span) * (height - stroke) - stroke / 2]);
  const d = points.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : `L${x.toFixed(1)} ${y.toFixed(1)}`)).join(' ');
  const fillPath = fill ? `${d} L${width} ${height} L0 ${height} Z` : null;
  const gradId = `spark-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={fillPath} fill={`url(#${gradId})`} />}
      <path d={d} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── LiveStatusBar ─────────────────────────────────────────────
// Compact 44px strip showing live pulse, today's revenue, staff clocked in,
// alert count, and last sync.
export function LiveStatusBar({
  todayRevenue = 0,
  avgDaily = 0,
  clockedIn = 0,
  alertCount = 0,
  lastSyncAgo = null, // e.g. "5m ago"
}) {
  const pct = avgDaily > 0 ? ((todayRevenue - avgDaily) / avgDaily) * 100 : null;
  const up = pct != null && pct >= 0;
  const Divider = () => <span aria-hidden="true" className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />;
  return (
    <div
      className="flex items-center gap-3 px-3 rounded-md border mb-3 overflow-x-auto"
      style={{
        height: 44,
        background: 'var(--bg-card)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ background: 'var(--color-success)' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--color-success)' }} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Live</span>
      </span>
      <Divider />
      <span className="flex items-center gap-1.5 flex-shrink-0 text-[12px]">
        <span style={{ color: 'var(--text-muted)' }}>Today</span>
        <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(todayRevenue)}</span>
        {pct != null && Math.abs(pct) >= 0.5 && (
          <span className="font-mono text-[11px]" style={{ color: up ? 'var(--color-success)' : 'var(--color-danger)' }}>
            {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
          </span>
        )}
      </span>
      <Divider />
      <span className="flex items-center gap-1 flex-shrink-0 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{clockedIn}</span> clocked in
      </span>
      {alertCount > 0 && (
        <>
          <Divider />
          <span className="flex items-center gap-1 flex-shrink-0 text-[12px]">
            <span
              className="inline-flex items-center justify-center text-[10px] font-bold px-1.5 rounded-full"
              style={{
                background: 'var(--color-warning-bg)',
                color: 'var(--color-warning)',
                minWidth: 18,
                height: 18,
              }}
            >{alertCount}</span>
            <span style={{ color: 'var(--color-warning)' }}>alert{alertCount === 1 ? '' : 's'}</span>
          </span>
        </>
      )}
      <span className="flex-1" />
      {lastSyncAgo && (
        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          Synced {lastSyncAgo}
        </span>
      )}
    </div>
  );
}

// ─── StatCardV2 ────────────────────────────────────────────────
// SaaS-dashboard stat card with label, value, trend %, sparkline.
export function StatCardV2({
  label,
  value,
  valueColor = 'var(--text-primary)',
  trendPct = null,     // numeric; positive/negative
  trendGoodWhenPositive = true,
  sparklineData = [],
  sparklineColor = null,
  sub = null,
}) {
  const color = sparklineColor || valueColor;
  const trendPositive = trendPct != null && trendPct >= 0;
  const trendIsGood = trendPct == null ? null : (trendGoodWhenPositive ? trendPositive : !trendPositive);
  const trendColor = trendIsGood == null ? 'var(--text-muted)' : trendIsGood ? 'var(--color-success)' : 'var(--color-danger)';
  return (
    <div
      className="rounded-[10px] border p-[14px] flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
    >
      <p className="text-[11px] uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</p>
      <p className="text-[22px] font-medium tabular-nums leading-none" style={{ color: valueColor }}>
        {value}
      </p>
      <div className="flex items-end justify-between gap-2">
        {trendPct != null ? (
          <span className="text-[11px] font-medium flex items-center gap-1 tabular-nums" style={{ color: trendColor }}>
            <span>{trendPositive ? '↑' : '↓'}</span>
            <span>{Math.abs(trendPct).toFixed(1)}%</span>
          </span>
        ) : sub ? (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</span>
        ) : (
          <span />
        )}
        <Sparkline data={sparklineData} color={color} width={50} height={14} />
      </div>
    </div>
  );
}

// ─── AlertCardV2 ───────────────────────────────────────────────
// Severity-coded alert with a colored left border and inline CTA button.
export function AlertCardV2({ severity = 'info', title, description, href, ctaLabel }) {
  const tones = {
    critical: { accent: 'var(--color-danger)', bg: 'rgba(239,68,68,0.04)', border: 'rgba(239,68,68,0.2)', btnBg: 'var(--color-danger)', btnText: '#ffffff', btnStyle: 'solid', cta: ctaLabel || 'Fix now' },
    warning:  { accent: 'var(--color-warning)',bg: 'rgba(245,158,11,0.04)',border: 'rgba(245,158,11,0.2)', btnBg: 'transparent', btnText: 'var(--color-warning)', btnStyle: 'outline', cta: ctaLabel || 'Review' },
    info:     { accent: 'var(--color-info)',   bg: 'rgba(59,130,246,0.04)', border: 'rgba(59,130,246,0.2)', btnBg: 'transparent', btnText: 'var(--color-info)',   btnStyle: 'ghost',   cta: ctaLabel || 'View' },
  };
  const tone = tones[severity] || tones.info;
  const content = (
    <div
      className="relative flex items-center gap-3 py-2.5 pr-3 pl-[14px]"
      style={{
        background: tone.bg,
        border: `0.5px solid ${tone.border}`,
        borderLeft: `3px solid ${tone.accent}`,
        borderRadius: '0 var(--radius-md) var(--radius-md) 0',
      }}
    >
      <div className="flex-1 min-w-0">
        {title && <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{title}</div>}
        {description && <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{description}</div>}
      </div>
      {href && (
        <span
          className="text-[11px] font-semibold px-2.5 py-1 rounded-md whitespace-nowrap flex-shrink-0"
          style={
            tone.btnStyle === 'solid'
              ? { background: tone.btnBg, color: tone.btnText }
              : tone.btnStyle === 'outline'
              ? { border: `1px solid ${tone.accent}`, color: tone.btnText }
              : { color: tone.btnText }
          }
        >
          {tone.cta} →
        </span>
      )}
    </div>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}

// ─── StorePerformanceRow ───────────────────────────────────────
// Linear-style dense row: rank, name + revenue bar, revenue, profit, margin pill.
export function StorePerformanceRow({
  rank,             // 1-indexed position
  name,
  color,            // store color
  revenue,
  profit,
  margin,           // 0..100
  maxRevenue,       // for the bar
  onClick,
  isFirst = false,
  isLast = false,
}) {
  const barPct = maxRevenue > 0 ? Math.max(0.02, revenue / maxRevenue) : 0;
  const shortName = name?.split(' - ').pop()?.trim() || name;

  let marginBg = 'var(--color-danger-bg)';
  let marginText = 'var(--color-danger)';
  let marginWeight = 500;
  if (margin >= 50) { marginBg = 'var(--color-success)'; marginText = '#052e16'; marginWeight = 600; }
  else if (margin >= 40) { marginBg = 'var(--color-warning-bg)'; marginText = 'var(--color-warning)'; }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full grid items-center gap-3 py-[14px] px-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      style={{
        gridTemplateColumns: '28px 1fr 110px 100px 72px',
        borderBottom: isLast ? 'none' : '0.5px solid rgba(255,255,255,0.04)',
        background: isFirst && color
          ? `linear-gradient(90deg, ${hexToRgba(color, 0.08)} 0%, transparent 60%)`
          : 'transparent',
      }}
    >
      <span className="text-[13px] text-center" style={{ color: isFirst ? 'var(--color-warning)' : 'var(--text-muted)' }}>
        {isFirst ? '🏆' : rank}
      </span>
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0" style={{ width: 8, height: 8, borderRadius: 2, background: color || 'var(--text-muted)' }} />
          <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{shortName}</span>
        </div>
        <div className="relative h-1 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div
            className="absolute left-0 top-0 bottom-0 rounded"
            style={{ width: `${(isFirst ? 1 : barPct) * 100}%`, background: color || 'var(--color-success)' }}
          />
        </div>
      </div>
      <span className="text-[13px] text-right tabular-nums font-mono" style={{ color: 'var(--text-primary)', fontWeight: isFirst ? 500 : 400 }}>
        {fmt(revenue || 0)}
      </span>
      <span className="text-[13px] text-right tabular-nums font-mono" style={{ color: profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
        {profit >= 0 ? '' : '−'}{fmt(Math.abs(profit || 0))}
      </span>
      <span className="justify-self-end text-[11px] px-2 py-0.5 rounded-full tabular-nums" style={{ background: marginBg, color: marginText, fontWeight: marginWeight }}>
        {(margin || 0).toFixed(1)}%
      </span>
    </button>
  );
}

function hexToRgba(hex, a) {
  if (!hex) return `rgba(255,255,255,${a})`;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── HeroNetProfit ─────────────────────────────────────────────
// Premium hero card: huge number, sparkline, progress bar toward pace.
export function HeroNetProfit({
  amount,
  rangeLabel,          // "This Month" or date range
  trendPct = null,     // vs previous period
  margin,              // 0..100
  paceMonthly,         // dollars projected to end of month
  daysLeft = null,
  target = null,       // optional monthly target
  sparklineData = [],
}) {
  const positive = amount >= 0;
  const trendPositive = trendPct != null && trendPct >= 0;
  const pacePct = target && target > 0 ? Math.min(1, Math.max(0, amount / target)) : (paceMonthly && paceMonthly > 0 ? Math.min(1, Math.max(0, amount / paceMonthly)) : 0);
  return (
    <div
      className="relative mb-5 p-6 overflow-hidden"
      style={{
        borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, #0f1a14 0%, #111113 60%)',
        border: '0.5px solid rgba(34,197,94,0.25)',
        borderLeft: '3px solid var(--color-success)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-[11px] uppercase font-semibold" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          Net Profit · {rangeLabel}
        </p>
        {trendPct != null && (
          <span
            className="text-[12px] font-medium px-2.5 py-1 rounded-full tabular-nums whitespace-nowrap"
            style={{
              background: trendPositive ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
              color: trendPositive ? 'var(--color-success)' : 'var(--color-danger)',
            }}
          >
            {trendPositive ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p
          className="tabular-nums"
          style={{
            fontSize: 56,
            fontWeight: 500,
            color: positive ? 'var(--color-success)' : 'var(--color-danger)',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {positive ? '' : '−'}{fmt(Math.abs(amount))}
        </p>
        <Sparkline data={sparklineData} color="var(--color-success)" width={180} height={56} stroke={2} />
      </div>
      <p className="text-[13px] mt-3" style={{ color: 'var(--text-secondary)' }}>
        Margin <span className="font-semibold" style={{ color: margin >= 20 ? 'var(--color-success)' : 'var(--color-warning)' }}>{(margin || 0).toFixed(1)}%</span>
        {paceMonthly != null && (
          <> · Pace <span className="font-semibold" style={{ color: paceMonthly >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{fK(paceMonthly)}/mo</span></>
        )}
      </p>
      <div className="mt-4">
        <div className="h-1 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="h-full rounded" style={{ width: `${(pacePct * 100).toFixed(1)}%`, background: 'var(--color-success)' }} />
        </div>
        <p className="text-[11px] mt-1.5 flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
          <span>{(pacePct * 100).toFixed(0)}% {target ? 'to target' : 'of projected pace'}</span>
          {daysLeft != null && <span>{daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>}
        </p>
      </div>
    </div>
  );
}
