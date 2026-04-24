'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Button, Alert, Loading, ConfirmModal } from '@/components/UI';

const fmtMoney = (n) => n == null ? '—' : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const STATUS_BADGES = {
  pending:   { label: 'Pending',   cls: 'bg-sw-card2 text-sw-sub border border-sw-border' },
  approved:  { label: 'Approved',  cls: 'bg-sw-blueD text-sw-blue border border-sw-blue/30' },
  ordered:   { label: 'Ordered',   cls: 'bg-sw-greenD text-sw-green border border-sw-green/30' },
  cancelled: { label: 'Cancelled', cls: 'bg-sw-redD text-sw-red border border-sw-red/30' },
};

// Effective vendor/price take the owner override when present, otherwise
// fall back to the frozen suggestion. Mirrors the email route's logic.
const effVendor = (it) => it.override_vendor || it.suggested_vendor || 'Unknown';
const effPrice  = (it) => Number(it.override_unit_price != null ? it.override_unit_price : (it.suggested_unit_price || 0));

export default function RestockDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const { profile, isOwner } = useAuth();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [request, setRequest] = useState(null);
  const [items, setItems] = useState([]);
  const [vendorOptions, setVendorOptions] = useState({}); // itemId -> [{vendor_name, unit_price}]
  const [savingStatus, setSavingStatus] = useState(false);
  const [emailResult, setEmailResult] = useState(null);
  const [emailing, setEmailing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/restock/${id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load');
      setRequest(j.request);
      setItems(j.request.items || []);
      setDirty(false);
    } catch (e) {
      setErr(e.message);
      setRequest(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) load(); }, [id, load]);

  // Lazy-fetch vendor alternatives for each row the first time the owner
  // opens the vendor dropdown. Employees don't see the dropdown so we skip.
  const fetchVendorOptions = useCallback(async (item) => {
    if (vendorOptions[item.id]) return;
    try {
      const qs = new URLSearchParams();
      qs.set('q', item.upc || item.product_name);
      const r = await fetch(`/api/warehouse-prices/search?${qs}`);
      const j = await r.json();
      if (!r.ok) return;
      // Find the closest product match and use its offers, sorted cheapest first.
      const product = (j.products || []).find(p =>
        (item.upc && p.upc === item.upc) ||
        (p.name || '').toLowerCase() === (item.product_name || '').toLowerCase()
      ) || (j.products || [])[0];
      const offers = (product?.offers || []).sort((a, b) => a.unit_price - b.unit_price);
      setVendorOptions(prev => ({ ...prev, [item.id]: offers }));
    } catch {}
  }, [vendorOptions]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = effVendor(it);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return Array.from(map.entries()).map(([vendor, list]) => ({
      vendor,
      items: list,
      subtotal: list.reduce((s, it) => s + effPrice(it) * (it.qty || 0), 0),
    }));
  }, [items]);

  const grandTotal = grouped.reduce((s, g) => s + g.subtotal, 0);

  const updateItem = (itemId, patch) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i));
    setDirty(true);
  };

  const saveChanges = async () => {
    setSavingStatus(true);
    try {
      const body = {
        items: items.map(i => ({
          id: i.id,
          qty: i.qty,
          override_vendor: i.override_vendor ?? null,
          override_unit_price: i.override_unit_price ?? null,
        })),
      };
      const r = await fetch(`/api/restock/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      setRequest(j.request);
      setItems(j.request.items || []);
      setDirty(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingStatus(false);
    }
  };

  const setStatus = async (status) => {
    setSavingStatus(true);
    try {
      // Save item edits alongside any status change so a single "Approve" click
      // doesn't silently drop pending qty/vendor edits on the ground.
      const body = {
        status,
        items: items.map(i => ({
          id: i.id,
          qty: i.qty,
          override_vendor: i.override_vendor ?? null,
          override_unit_price: i.override_unit_price ?? null,
        })),
      };
      const r = await fetch(`/api/restock/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Status update failed');
      setRequest(j.request);
      setItems(j.request.items || []);
      setDirty(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingStatus(false);
    }
  };

  const doDelete = async () => {
    try {
      const r = await fetch(`/api/restock/${id}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Delete failed'); }
      router.push('/restock');
    } catch (e) {
      alert(e.message);
      setConfirmDelete(false);
    }
  };

  const exportCsv = () => {
    const headers = ['vendor', 'product', 'upc', 'variant', 'qty', 'unit_price', 'line_total'];
    const rows = [headers.join(',')];
    for (const g of grouped) {
      for (const it of g.items) {
        const price = effPrice(it);
        const total = price * (it.qty || 0);
        const cells = [
          g.vendor,
          it.product_name,
          it.upc || '',
          it.variant || '',
          String(it.qty || 0),
          price.toFixed(2),
          total.toFixed(2),
        ].map(c => {
          const s = String(c ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        });
        rows.push(cells.join(','));
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restock-${id.slice(0, 8)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    // Dynamic import to keep the heavy jspdf bundle out of the initial page load.
    const [{ jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = autoTableMod.default || autoTableMod;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const marginX = 40;
    let firstPage = true;

    for (const g of grouped) {
      if (!firstPage) doc.addPage();
      firstPage = false;
      let y = 48;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      doc.text('Purchase Order', marginX, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      y += 22;
      doc.text(`Store: ${request?.stores?.name || '—'}`, marginX, y); y += 14;
      doc.text(`Vendor: ${g.vendor}`, marginX, y); y += 14;
      doc.text(`Request #: ${id.slice(0, 8)}`, marginX, y); y += 14;
      doc.text(`Date: ${fmtDate(request?.created_at)}`, marginX, y); y += 18;

      autoTable(doc, {
        startY: y,
        head: [['Product', 'UPC', 'Qty', 'Unit', 'Total']],
        body: g.items.map(it => {
          const price = effPrice(it);
          return [
            it.product_name + (it.variant ? ` (${it.variant})` : ''),
            it.upc || '',
            String(it.qty || 0),
            fmtMoney(price),
            fmtMoney(price * (it.qty || 0)),
          ];
        }),
        foot: [['', '', '', 'Subtotal', fmtMoney(g.subtotal)]],
        styles: { fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255 },
        footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        margin: { left: marginX, right: marginX },
      });
    }

    doc.save(`restock-${id.slice(0, 8)}.pdf`);
  };

  const emailPOs = async () => {
    setEmailing(true);
    setEmailResult(null);
    try {
      const r = await fetch(`/api/restock/${id}/email`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Email failed');
      setEmailResult(j);
    } catch (e) {
      alert(e.message);
    } finally {
      setEmailing(false);
    }
  };

  if (loading) return <Loading />;
  if (err) return <Alert type="error">{err}</Alert>;
  if (!request) return <Alert type="error">Request not found.</Alert>;

  const readOnly = !isOwner;
  const status = request.status;
  const cfg = STATUS_BADGES[status] || STATUS_BADGES.pending;

  return (
    <div className="py-4 md:py-6 max-w-[1200px]">
      <div className="mb-3">
        <button
          onClick={() => router.push('/restock')}
          className="text-sw-sub text-[12px] hover:text-sw-text"
        >
          ← Back to requests
        </button>
      </div>

      <PageHeader
        title={`Restock #${id.slice(0, 8)}`}
        subtitle={request.stores?.name ? `${request.stores.name} · submitted ${fmtDate(request.created_at)} by ${request.created_by_name || '—'}` : fmtDate(request.created_at)}
      >
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${cfg.cls}`}>{cfg.label}</span>
      </PageHeader>

      {request.note && (
        <div className="mb-4 bg-sw-card border border-sw-border rounded-xl p-3 text-sw-sub text-[12px]">
          <span className="text-sw-dim text-[10px] font-bold uppercase tracking-wider block mb-1">Note from {request.created_by_name || 'employee'}</span>
          {request.note}
        </div>
      )}

      {/* Action bar */}
      {!readOnly && (
        <div className="mb-4 bg-sw-card border border-sw-border rounded-xl p-3 flex gap-2 flex-wrap">
          <Button variant="primary" onClick={saveChanges} className={!dirty ? 'opacity-50 cursor-not-allowed' : ''} disabled={!dirty || savingStatus}>
            {savingStatus ? 'Saving…' : 'Save changes'}
          </Button>
          {status !== 'approved' && status !== 'ordered' && (
            <Button variant="success" onClick={() => setStatus('approved')} disabled={savingStatus}>Approve</Button>
          )}
          {status !== 'ordered' && (
            <Button variant="success" onClick={() => setStatus('ordered')} disabled={savingStatus}>Mark as Ordered</Button>
          )}
          {status !== 'cancelled' && (
            <Button variant="danger" onClick={() => setStatus('cancelled')} disabled={savingStatus}>Cancel</Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={exportPdf}>Export PDF</Button>
          <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
          <Button variant="secondary" onClick={emailPOs} disabled={emailing}>
            {emailing ? 'Sending…' : 'Email POs'}
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
        </div>
      )}

      {emailResult && (
        <div className="mb-4 space-y-2">
          {emailResult.sent?.length > 0 && (
            <Alert type="info">
              Sent {emailResult.sent.length} PO{emailResult.sent.length === 1 ? '' : 's'}: {emailResult.sent.map(s => `${s.vendor} (${s.email})`).join(', ')}
            </Alert>
          )}
          {emailResult.skipped?.length > 0 && (
            <Alert type="warning">
              Skipped {emailResult.skipped.length}: {emailResult.skipped.map(s => `${s.vendor} — ${s.reason}`).join('; ')}
            </Alert>
          )}
        </div>
      )}

      {/* Vendor groups */}
      {grouped.map(group => (
        <div key={group.vendor} className="mb-4 rounded-xl border border-sw-border bg-sw-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-sw-border flex items-center justify-between bg-sw-card2/40">
            <div>
              <div className="text-sw-text text-[14px] font-bold">{group.vendor}</div>
              <div className="text-sw-sub text-[11px]">{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</div>
            </div>
            <div className="text-right">
              <div className="text-sw-dim text-[10px] font-bold uppercase tracking-wider">Subtotal</div>
              <div className="text-sw-text text-[14px] font-bold font-mono">{fmtMoney(group.subtotal)}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-sw-dim text-left border-b border-sw-border">
                  <th className="py-2 px-3 font-semibold">Product</th>
                  <th className="py-2 px-3 font-semibold">UPC</th>
                  <th className="py-2 px-3 font-semibold text-right">Qty</th>
                  <th className="py-2 px-3 font-semibold">Vendor</th>
                  <th className="py-2 px-3 font-semibold text-right">Unit</th>
                  <th className="py-2 px-3 font-semibold text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map(item => {
                  const price = effPrice(item);
                  const options = vendorOptions[item.id] || [];
                  return (
                    <tr key={item.id} className="border-b border-sw-border/60">
                      <td className="py-2 px-3 text-sw-text">
                        <div className="font-semibold max-w-[320px] truncate">{item.product_name}</div>
                        {item.variant && <div className="text-sw-sub text-[11px] truncate max-w-[320px]">{item.variant}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono text-[10px] text-sw-dim whitespace-nowrap">{item.upc || '—'}</td>
                      <td className="py-2 px-3 text-right">
                        {readOnly ? (
                          <span className="text-sw-text font-semibold">{item.qty}</span>
                        ) : (
                          <input
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={e => updateItem(item.id, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                            className="w-16 text-right px-1.5 py-1 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[12px]"
                          />
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {readOnly ? (
                          <span className="text-sw-text">{effVendor(item)}</span>
                        ) : (
                          <select
                            value={item.override_vendor || item.suggested_vendor || ''}
                            onFocus={() => fetchVendorOptions(item)}
                            onChange={e => {
                              const v = e.target.value;
                              const suggested = item.suggested_vendor || '';
                              if (v === suggested) {
                                // Reset to suggestion — drop both overrides so the row
                                // reverts to the frozen suggested vendor + price.
                                updateItem(item.id, { override_vendor: null, override_unit_price: null });
                              } else {
                                const pick = options.find(o => o.vendor_name === v);
                                updateItem(item.id, {
                                  override_vendor: v || null,
                                  override_unit_price: pick ? pick.unit_price : item.override_unit_price,
                                });
                              }
                            }}
                            className="!w-auto !min-h-0 !py-1 !px-2 !text-[11px] bg-sw-card2 border border-sw-border rounded-md text-sw-text"
                          >
                            <option value={item.suggested_vendor || ''}>
                              {item.suggested_vendor || 'No suggestion'}{item.suggested_unit_price != null ? ` · ${fmtMoney(item.suggested_unit_price)}` : ''}
                            </option>
                            {options
                              .filter(o => o.vendor_name !== item.suggested_vendor)
                              .map(o => (
                                <option key={o.vendor_id || o.vendor_name} value={o.vendor_name}>
                                  {o.vendor_name} · {fmtMoney(o.unit_price)}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {readOnly ? (
                          <span className="text-sw-text">{fmtMoney(price)}</span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.override_unit_price != null ? item.override_unit_price : (item.suggested_unit_price ?? '')}
                            onChange={e => {
                              const v = e.target.value;
                              updateItem(item.id, {
                                override_unit_price: v === '' ? null : Number(v),
                              });
                            }}
                            className="w-24 text-right px-1.5 py-1 bg-sw-card2 border border-sw-border rounded-md text-sw-text text-[12px]"
                          />
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-sw-text whitespace-nowrap">{fmtMoney(price * (item.qty || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {grouped.length > 0 && (
        <div className="flex justify-end mt-2 mb-6">
          <div className="bg-sw-card border border-sw-border rounded-xl px-5 py-3 text-right">
            <div className="text-sw-dim text-[10px] font-bold uppercase tracking-wider">Grand total</div>
            <div className="text-sw-text text-[20px] font-extrabold font-mono">{fmtMoney(grandTotal)}</div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete this restock request?"
          message="This will permanently remove the request and all of its line items. This cannot be undone."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}
