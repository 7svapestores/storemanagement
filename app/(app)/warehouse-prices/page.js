'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Alert, Loading, EmptyState } from '@/components/UI';

const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate  = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export default function WarehousePricesPage() {
  const { isOwner } = useAuth();
  // Bumped by UploadPanel after every successful ingest — AllProductsTable
  // watches this to auto-refresh without a page reload.
  const [refreshToken, setRefreshToken] = useState(0);
  const onIngested = useCallback(() => setRefreshToken(t => t + 1), []);

  if (!isOwner) return <Alert type="warning">Owner only.</Alert>;

  return (
    <div className="py-4 md:py-6 max-w-[1200px]">
      <PageHeader
        title="Warehouse Prices"
        subtitle="Upload vendor invoices and search the catalog to find the cheapest source per product."
      />
      <div className="grid gap-5 md:grid-cols-2">
        <UploadPanel onIngested={onIngested} />
        <SearchPanel />
      </div>
      <AllProductsTable refreshToken={refreshToken} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Upload panel — drag-drop PDFs; each file hits /api/warehouse-prices/ingest.
// ═══════════════════════════════════════════════════════════════
function UploadPanel({ onIngested }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]); // { filename, ok, message, data? }

  const onFiles = useCallback(async (files) => {
    if (!files?.length) return;
    setBusy(true);
    const fresh = [];
    let anySuccess = false;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/warehouse-prices/ingest', { method: 'POST', body: fd });
        const j = await r.json();
        if (r.ok) {
          fresh.push({
            filename: file.name,
            ok: true,
            message: `Ingested ${j.items_ingested} items · ${j.vendor} · ${j.invoice_number || 'no #'} · ${fmtMoney(j.grand_total)}`,
            data: j,
          });
          anySuccess = true;
        } else if (r.status === 409) {
          fresh.push({ filename: file.name, ok: false, message: `Already ingested (invoice ${j.invoice_number})` });
        } else if (r.status === 422) {
          fresh.push({ filename: file.name, ok: false, message: j.error, snippet: j.text_snippet });
        } else {
          fresh.push({ filename: file.name, ok: false, message: j.error || 'Upload failed' });
        }
      } catch (e) {
        fresh.push({ filename: file.name, ok: false, message: e.message || 'Upload failed' });
      }
    }
    setResults(r => [...fresh, ...r].slice(0, 20));
    setBusy(false);
    if (anySuccess) onIngested?.();
  }, [onIngested]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    onFiles(Array.from(e.dataTransfer.files || []).filter(f => /\.pdf$/i.test(f.name)));
  }, [onFiles]);

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4">
      <h3 className="text-sw-text text-[15px] font-bold mb-1">Upload invoices</h3>
      <p className="text-sw-sub text-[12px] mb-3">
        Drop one or many PDFs. We auto-extract line items and save them to your price history.
        Known layouts (Rave Distribution, NEPA Dallas) parse instantly; unknown layouts are handled by Claude.
      </p>

      <label
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        className="block border-2 border-dashed border-sw-border hover:border-sw-blue/60 rounded-lg p-8 text-center cursor-pointer transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={e => onFiles(Array.from(e.target.files || []))}
        />
        <div className="text-3xl mb-2">📄</div>
        <div className="text-sw-text text-[13px] font-semibold">Drop PDFs here or click to choose</div>
        <div className="text-sw-dim text-[11px] mt-1">You can select multiple files</div>
      </label>

      {busy && <div className="mt-3 text-sw-sub text-[12px]">Parsing…</div>}

      {results.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {results.map((r, i) => <ResultRow key={i} r={r} />)}
        </div>
      )}
    </div>
  );
}

function ResultRow({ r }) {
  const [showSnippet, setShowSnippet] = useState(false);
  return (
    <div className={`text-[12px] px-3 py-2 rounded-md border
      ${r.ok ? 'bg-sw-blueD border-sw-blue/30' : 'bg-sw-redD border-sw-red/30'}`}>
      <div className="flex items-start gap-2 text-sw-text">
        <span>{r.ok ? '✓' : '✕'}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{r.filename}</div>
          <div className="text-sw-sub">{r.message}</div>
          {r.snippet && (
            <button onClick={() => setShowSnippet(s => !s)}
              className="mt-1 text-sw-blue text-[11px] hover:underline">
              {showSnippet ? 'Hide' : 'Show'} raw extracted text
            </button>
          )}
        </div>
      </div>
      {showSnippet && r.snippet && (
        <pre className="mt-2 text-[10px] text-sw-sub bg-sw-bg border border-sw-border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
          {r.snippet}
        </pre>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Search panel — smart search over the product catalog, with
// per-warehouse prices shown cheapest first.
// ═══════════════════════════════════════════════════════════════
function SearchPanel() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setBusy(true); setErr('');
      try {
        const r = await fetch(`/api/warehouse-prices/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Search failed');
        setResults(j.products || []);
      } catch (e) {
        setErr(e.message);
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  return (
    <div className="rounded-xl border border-sw-border bg-sw-card p-4">
      <h3 className="text-sw-text text-[15px] font-bold mb-1">Find best price</h3>
      <p className="text-sw-sub text-[12px] mb-3">
        Search by product name, brand, variant, or UPC. Results show every warehouse that's carried the item, cheapest first.
      </p>

      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="e.g. foger berry, geek bar miami mint, 850049202930"
        className="w-full px-3 py-2.5 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[13px] focus:outline-none focus:border-sw-blue"
      />

      {busy && <div className="mt-3 text-sw-sub text-[12px]">Searching…</div>}
      {err && <Alert type="error">{err}</Alert>}

      {!busy && !err && q && !results.length && (
        <div className="mt-4">
          <EmptyState icon="🔎" title="No matches" message="Try a different spelling, brand, or UPC." />
        </div>
      )}

      <div className="mt-3 space-y-2 max-h-[520px] overflow-y-auto">
        {results.map(p => (
          <div key={p.id} className="rounded-lg border border-sw-border bg-sw-card2 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sw-text text-[13px] font-semibold truncate">{p.name}</div>
                {p.variant && <div className="text-sw-sub text-[11px]">{p.variant}</div>}
              </div>
              {p.upc && <div className="text-sw-dim text-[10px] font-mono shrink-0">{p.upc}</div>}
            </div>

            {p.offers?.length ? (
              <div className="mt-2 space-y-1">
                {p.offers.map((o, i) => {
                  const cheapest = Number(p.offers[0].unit_price) || 0;
                  const diff = +(Number(o.unit_price) - cheapest).toFixed(2);
                  const rankLabels = ['1st choice', '2nd choice', '3rd choice'];
                  const rank = rankLabels[i] || `${i + 1}th choice`;
                  return (
                    <div key={o.vendor_id || i}
                      className={`flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-md
                        ${i === 0
                          ? 'bg-sw-blueD text-sw-text border border-sw-blue/30'
                          : i === 1
                            ? 'text-sw-text border border-sw-border/60 bg-sw-card2/50'
                            : 'text-sw-sub border border-transparent'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-bold shrink-0 uppercase tracking-wide
                          ${i === 0 ? 'text-sw-blue' : i === 1 ? 'text-sw-text' : 'text-sw-dim'}`}>
                          {rank}
                        </span>
                        <span className="font-semibold truncate">{o.vendor_name}</span>
                        {o.invoice_number && (o.invoice_url
                          ? <a href={o.invoice_url} target="_blank" rel="noopener noreferrer"
                              className="text-sw-blue text-[10px] font-mono hover:underline shrink-0"
                              title="Open invoice PDF">#{o.invoice_number}</a>
                          : <span className="text-sw-dim text-[10px] font-mono shrink-0">#{o.invoice_number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {i > 0 && diff > 0 && (
                          <span className="text-sw-red text-[10px] font-semibold"
                                title={`$${diff.toFixed(2)} more per unit than 1st choice`}>
                            +{fmtMoney(diff)}
                          </span>
                        )}
                        <span className="text-sw-dim text-[10px]">last {fmtDate(o.last_bought)}</span>
                        <span className={`font-bold ${i === 0 ? 'text-sw-blue' : 'text-sw-text'}`}>{fmtMoney(o.unit_price)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-1 text-sw-dim text-[11px]">No price history yet.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// All products — one row per invoice line item, with a single smart
// search box that filters across product / vendor / invoice # / UPC.
// ═══════════════════════════════════════════════════════════════
function AllProductsTable({ refreshToken = 0 }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const debounceRef = useRef(null);

  const load = useCallback(async (query) => {
    setLoading(true); setErr('');
    try {
      const url = `/api/warehouse-prices/prices${query ? `?q=${encodeURIComponent(query)}&limit=200` : '?limit=200'}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Load failed');
      setRows(j.prices || []);
    } catch (e) {
      setErr(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + debounced reload on search input + refresh-token bumps
  // (signaled by the upload panel after each successful ingest).
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(q), q ? 250 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [q, load, refreshToken]);

  return (
    <div className="mt-6 rounded-xl border border-sw-border bg-sw-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-sw-text text-[15px] font-bold mb-2">All products</h3>
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search anything — product, warehouse, invoice #, UPC, variant, price..."
            className="w-full px-3 py-2.5 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[13px] focus:outline-none focus:border-sw-blue"
          />
        </div>
        <div className="text-sw-sub text-[11px] whitespace-nowrap">
          {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
          {q && !loading && ` for "${q}"`}
        </div>
      </div>

      {err && <Alert type="error">{err}</Alert>}

      {!loading && !err && !rows.length && (
        <EmptyState
          icon={q ? '🔎' : '📦'}
          title={q ? 'No matches' : 'No products yet'}
          message={q ? 'Try a shorter query or different spelling.' : 'Upload a vendor invoice PDF to populate the catalog.'}
        />
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-sw-dim text-left border-b border-sw-border">
                <th className="py-2 pr-3 font-semibold">Product</th>
                <th className="py-2 pr-3 font-semibold">UPC</th>
                <th className="py-2 pr-3 font-semibold">Warehouse</th>
                <th className="py-2 pr-3 font-semibold text-right" title="Lowest price ever seen from this warehouse">Best $</th>
                <th className="py-2 pr-3 font-semibold text-right" title="Total units bought across all invoices">Total Qty</th>
                <th className="py-2 pr-3 font-semibold">Last bought</th>
                <th className="py-2 pr-3 font-semibold">Invoice (best)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-sw-border/60 text-sw-text align-top">
                  <td className="py-2 pr-3">
                    <div className="font-semibold truncate max-w-[320px]">{r.product?.name || '—'}</div>
                    {r.product?.variant && (
                      <div className="text-sw-sub text-[11px] truncate max-w-[320px]">{r.product.variant}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[10px] text-sw-dim whitespace-nowrap">{r.product?.upc || '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.vendor?.name || '—'}</td>
                  <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap">{fmtMoney(r.unit_price)}</td>
                  <td className="py-2 pr-3 text-right text-sw-sub whitespace-nowrap">
                    {Number(r.quantity || 0)}
                    {r.purchase_count > 1 && (
                      <span className="text-sw-dim text-[10px] ml-1" title={`${r.purchase_count} separate invoice lines`}>
                        ×{r.purchase_count}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-sw-sub whitespace-nowrap">{fmtDate(r.last_bought || r.invoice?.date)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] whitespace-nowrap">
                    {r.invoice?.number
                      ? (r.invoice.url
                          ? <a href={r.invoice.url} target="_blank" rel="noopener noreferrer"
                               className="text-sw-blue hover:underline" title="Open the invoice where this best price was recorded">
                              {r.invoice.number}
                            </a>
                          : r.invoice.number)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
