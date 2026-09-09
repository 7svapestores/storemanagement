'use client';
import useIsMobile from '@/lib/use-is-mobile';
import { storeShortName } from '@/lib/utils';
import { customStores } from '@/lib/pricebook-grouping';

const fmtCents = (c) => (Number.isFinite(c) ? `$${(c / 100).toFixed(2)}` : '—');

// globals.css sets `width: 100%` on every untyped input and select, so any
// width here has to be marked important or the box swells to fill its row
// and crushes whatever sits beside it.
const PRICE_INPUT = 'rounded border border-sw-border bg-sw-bg px-2 py-1.5 text-right text-sw-text';

// One item's price in every store, with somewhere to type a new one.
//
// Five stores plus a name and a UPC will not fit across a phone, so the same
// data is laid out two ways: a table on desktop, and one card per item on
// mobile. The layout is chosen in JS rather than by rendering both and hiding
// one, so an item never has two price inputs on the page at once.
export default function PriceGrid({
  rows,
  stores,
  targetStores,
  rowValue,             // (row) => string
  onRowChange,          // (upc, value) => void
  rowPlaceholder,       // (row) => string
  rowLabel = 'New price',
  cellValue,            // (storeId, row) => string | undefined
  onCellChange,         // (storeId, upc, value) => void — read-only when absent
  unreachableStores = new Set(),
  showUpc = true,
}) {
  const isMobile = useIsMobile();
  const Layout = isMobile ? MobileCards : DesktopTable;
  return (
    <Layout
      rows={rows} stores={stores} targetStores={targetStores}
      rowValue={rowValue} onRowChange={onRowChange} rowPlaceholder={rowPlaceholder}
      rowLabel={rowLabel} cellValue={cellValue} onCellChange={onCellChange}
      unreachableStores={unreachableStores} showUpc={showUpc}
    />
  );
}

function StoreValue({ row, store, isCustom, unreachable, cellValue, onCellChange, compact }) {
  const cents = row.prices[store.id];
  const title = unreachable
    ? `${store.name} could not be reached`
    : !Number.isFinite(cents)
      ? `${store.name} does not carry this item`
      : isCustom
        ? `${store.name} has its own price — protected from a group change`
        : undefined;

  if (unreachable) return <span className="text-[var(--text-muted)]" title={title}>?</span>;
  if (!Number.isFinite(cents)) return <span className="text-[var(--text-muted)]" title={title}>—</span>;

  if (onCellChange) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          value={cellValue?.(store.id, row) ?? ''}
          onChange={e => onCellChange(store.id, row.upc, e.target.value)}
          placeholder={(cents / 100).toFixed(2)}
          inputMode="decimal"
          title={title}
          aria-label={`${store.name} price for ${row.upc}`}
          className={`${compact ? '!w-[72px]' : '!w-20'} ${PRICE_INPUT} text-[12px]`}
        />
        {isCustom && <span className="text-[10px] text-[var(--color-warning)]" title={title}>⚑</span>}
      </span>
    );
  }

  return (
    <span className={`tabular-nums ${isCustom ? 'text-[var(--color-warning)]' : 'text-sw-text'}`} title={title}>
      {fmtCents(cents)}{isCustom ? ' ⚑' : ''}
    </span>
  );
}

// ── Phone: one card per item ────────────────────────────────────────────
//
// The name gets a full-width line of its own. Sharing a line with the price
// box means the box wins and the name wraps one word per line.
function MobileCards({
  rows, stores, targetStores, rowValue, onRowChange, rowPlaceholder, rowLabel,
  cellValue, onCellChange, unreachableStores, showUpc,
}) {
  return (
    <div className="space-y-2">
      {rows.map(row => {
        const custom = new Set(customStores(row));
        return (
          <div key={row.upc} className="rounded-lg border border-sw-border bg-sw-bg/40 p-2.5">
            <div className="text-[13px] font-semibold leading-snug text-sw-text">
              {row.variant || row.name}
            </div>
            {(showUpc || row.nameConflict) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-muted)]">
                {showUpc && <span className="font-mono">{row.upc}</span>}
                {row.nameConflict && (
                  <span className="text-[var(--color-warning)]">⚠ name differs by store</span>
                )}
              </div>
            )}

            <label className="mt-2 flex items-center justify-between gap-2 border-t border-sw-border/60 pt-2">
              <span className="text-[11px] text-[var(--text-muted)]">{rowLabel}</span>
              <input
                value={rowValue(row)}
                onChange={e => onRowChange(row.upc, e.target.value)}
                placeholder={rowPlaceholder?.(row) ?? ''}
                inputMode="decimal"
                aria-label={`New price for ${row.upc}`}
                className={`!w-24 ${PRICE_INPUT} text-[14px]`}
              />
            </label>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-sw-border/60 pt-2">
              {stores.map(store => (
                <div
                  key={store.id}
                  className={`flex items-center justify-between gap-1.5 text-[12px] ${
                    targetStores.includes(store.id) ? '' : 'opacity-40'
                  }`}
                >
                  <span className="truncate text-[var(--text-muted)]" title={store.name}>
                    {storeShortName(store.name)}
                  </span>
                  <StoreValue
                    row={row} store={store} isCustom={custom.has(store.id)}
                    unreachable={unreachableStores.has(store.name)}
                    cellValue={cellValue} onCellChange={onCellChange} compact
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Desktop: one row per item ───────────────────────────────────────────
function DesktopTable({
  rows, stores, targetStores, rowValue, onRowChange, rowPlaceholder, rowLabel,
  cellValue, onCellChange, unreachableStores, showUpc,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12px]">
        <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="px-2 py-1.5 text-left font-semibold">Item</th>
            <th className="px-2 py-1.5 text-left font-semibold">{rowLabel}</th>
            {stores.map(s => (
              <th
                key={s.id}
                title={s.name}
                className={`px-2 py-1.5 text-right font-semibold ${targetStores.includes(s.id) ? '' : 'opacity-40'}`}
              >
                {storeShortName(s.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const custom = new Set(customStores(row));
            return (
              <tr key={row.upc} className="border-t border-sw-border/60">
                <td className="px-2 py-1.5">
                  <span className="text-[var(--text-secondary)]">{row.variant || row.name}</span>
                  {row.nameConflict && (
                    <span className="ml-1.5 text-[10px] text-[var(--color-warning)]" title="Stores spell this item differently">
                      ⚠ name differs
                    </span>
                  )}
                  {showUpc && <div className="font-mono text-[10px] text-[var(--text-muted)]">{row.upc}</div>}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={rowValue(row)}
                    onChange={e => onRowChange(row.upc, e.target.value)}
                    placeholder={rowPlaceholder?.(row) ?? ''}
                    inputMode="decimal"
                    aria-label={`New price for ${row.upc}`}
                    className={`!w-20 ${PRICE_INPUT} text-[12px]`}
                  />
                </td>
                {stores.map(store => (
                  <td
                    key={store.id}
                    className={`px-2 py-1.5 text-right ${targetStores.includes(store.id) ? '' : 'opacity-40'}`}
                  >
                    <StoreValue
                      row={row} store={store} isCustom={custom.has(store.id)}
                      unreachable={unreachableStores.has(store.name)}
                      cellValue={cellValue} onCellChange={onCellChange}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
