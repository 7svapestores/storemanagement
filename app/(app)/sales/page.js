'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Alert, Loading, StoreBadge, ConfirmModal, StoreRequiredModal } from '@/components/UI';
import { fmt, fK, dayLabel, today, downloadCSV, hasRegister2 } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

export default function SalesPage() {
  const { supabase, isOwner, isEmployee, profile, effectiveStoreId, setSelectedStore } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [sales, setSales] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [activeTab, setActiveTab] = useState('r1'); // 'r1' | 'r2' | 'summary'
  const [form, setForm] = useState({
    date: today(),
    // Register 1
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    credits: '',
    // Register 2 (Bells/Kerens) — no gross, no card, no credits
    r2_net: '',
    register2_cash: '', // cash-to-cash (R2 cash transferred to R1)
    r2_safe_drop: '',
    notes: '',
  });

  const blankForm = () => ({
    date: today(),
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    credits: '',
    r2_net: '',
    register2_cash: '',
    r2_safe_drop: '',
    notes: '',
  });

  // All queries + mutations scope to the selected store (or employee's assigned store).
  const storeId = effectiveStoreId;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: storeData, error: storeErr } = await supabase
        .from('stores').select('*').order('created_at');
      if (storeErr) console.error('[sales] stores query error:', storeErr);
      setStores(storeData || []);

      // Drop the profiles!fkey embed — that join was failing silently when
      // the FK constraint name didn't match. Fetch profiles separately and
      // merge in JS so we still show "entered by".
      let q = supabase
        .from('daily_sales')
        .select('*, stores(name, color)')
        .gte('date', range.start)
        .lte('date', range.end)
        .order('date', { ascending: false });
      if (storeId) q = q.eq('store_id', storeId);

      const { data: salesData, error: salesErr } = await q;
      if (salesErr) {
        console.error('[sales] daily_sales query error:', salesErr);
        throw salesErr;
      }
      console.log('[sales] loaded', salesData?.length, 'rows', { range, storeId });

      // Lookup entered_by names in a single follow-up query.
      const enteredByIds = [...new Set((salesData || []).map(r => r.entered_by).filter(Boolean))];
      let nameById = {};
      if (enteredByIds.length) {
        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, name, username, role')
          .in('id', enteredByIds);
        if (profErr) {
          console.warn('[sales] profile lookup failed (non-fatal):', profErr);
        } else {
          nameById = Object.fromEntries((profs || []).map(p => [p.id, p]));
        }
      }

      const merged = (salesData || []).map(r => ({
        ...r,
        profiles: nameById[r.entered_by] || null,
      }));

      setSales(merged);

      // form no longer carries store_id — use storeId from context on save
    } catch (e) {
      console.error('[sales] load failed:', e);
      setLoadError(e?.message || 'Failed to load sales data');
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, storeId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const num = (v) => parseFloat(v) || 0;
    const storeIdToUse = isEmployee ? profile.store_id : effectiveStoreId;
    if (!storeIdToUse) {
      setMsg('Please select a store from the sidebar first.');
      return;
    }
    const storeForRegister = stores.find(s => s.id === storeIdToUse);
    const usesReg2 = hasRegister2(storeForRegister?.name);

    // Required Register 1 fields.
    const r1Required = ['r1_gross', 'r1_net', 'cash_sales', 'card_sales', 'r1_canceled_basket', 'r1_safe_drop', 'r1_sales_tax'];
    if (r1Required.some(k => form[k] === '')) {
      setMsg('Register 1: Gross, Net, Cash, Card, Canceled Basket, Safe Drop, and Sales Tax are all required.');
      setActiveTab('r1');
      return;
    }
    if (usesReg2 && (form.r2_net === '' || form.register2_cash === '' || form.r2_safe_drop === '')) {
      setMsg('Register 2: Net, Cash, and Safe Drop are all required.');
      setActiveTab('r2');
      return;
    }

    const data = {
      store_id: storeIdToUse,
      // Employees can only enter for today.
      date: isEmployee ? today() : form.date,
      // Register 1
      r1_gross: num(form.r1_gross),
      r1_net: num(form.r1_net),
      cash_sales: num(form.cash_sales),
      card_sales: num(form.card_sales),
      r1_canceled_basket: num(form.r1_canceled_basket),
      r1_safe_drop: num(form.r1_safe_drop),
      r1_sales_tax: num(form.r1_sales_tax),
      credits: num(form.credits),
      // Register 2 (zeros for single-register stores)
      r2_net: usesReg2 ? num(form.r2_net) : 0,
      r2_gross: usesReg2 ? num(form.r2_net) : 0, // legacy column kept in sync
      register2_cash: usesReg2 ? num(form.register2_cash) : 0,
      r2_safe_drop: usesReg2 ? num(form.r2_safe_drop) : 0,
      register2_card: 0,
      register2_credits: 0,
      // Short/over is now derived by the DB trigger from safe_drop - cash_sales.
      // We still send 0 so existing column-level checks don't break; trigger overwrites.
      r1_short_over: 0,
      r2_short_over: 0,
      notes: form.notes,
      entered_by: profile.id,
    };

    const storeName = stores.find(s => s.id === data.store_id)?.name;
    const total = data.cash_sales + data.card_sales;

    // Owner-side upsert into the employee_shortover ledger. Triggered whenever
    // a sale has a non-zero short/over entered. Keyed by sales row id.
    const upsertShortOver = async (salesId) => {
      if (!isOwner) return;
      const r1 = data.r1_short_over || 0;
      const r2 = data.r2_short_over || 0;
      const total = r1 + r2;
      if (total === 0 && r1 === 0 && r2 === 0) {
        // If cleared, remove any existing row for this sale.
        await supabase.from('employee_shortover').delete().eq('sales_id', salesId);
        return;
      }
      // Look up the employee's name from profiles.
      const { data: empProfile } = await supabase
        .from('profiles').select('name').eq('id', data.entered_by).maybeSingle();
      const payload = {
        sales_id: salesId,
        employee_id: data.entered_by,
        employee_name: empProfile?.name || null,
        store_id: data.store_id,
        date: data.date,
        r1_short: r1,
        r2_short: r2,
        total_short: total,
      };
      // Upsert by unique sales_id.
      const { error: eoErr } = await supabase
        .from('employee_shortover')
        .upsert(payload, { onConflict: 'sales_id' });
      if (eoErr) console.warn('[sales] employee_shortover upsert failed:', eoErr);
    };

    if (modal === 'edit' && editItem) {
      const { error } = await supabase.from('daily_sales').update(data).eq('id', editItem.id);
      if (error) { setMsg(error.message); return; }
      await upsertShortOver(editItem.id);
      await logActivity(supabase, profile, {
        action: 'update',
        entityType: 'daily_sales',
        entityId: editItem.id,
        description: `${profile?.name} updated daily sale of ${fmtMoney(data.r1_gross + data.r2_gross)} for ${storeName} on ${shortDate(data.date)}`,
        storeName,
        metadata: { before: editItem, after: data },
      });
    } else {
      // Duplicate guard: employees cannot submit twice for the same store/date.
      // Owners are allowed to bypass (e.g. correcting missed entries).
      if (!isOwner) {
        const { data: existing } = await supabase
          .from('daily_sales')
          .select('id')
          .eq('store_id', data.store_id)
          .eq('date', data.date)
          .maybeSingle();
        if (existing) {
          setMsg(`Sales already entered for this store on ${shortDate(data.date)}. Contact the owner if you need to make changes.`);
          return;
        }
      }

      const { data: inserted, error } = await supabase.from('daily_sales').insert(data).select().single();
      if (error) {
        // Postgres unique_violation. Translate the raw error into a clear message.
        if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
          setMsg(`Sales already entered for this store on ${shortDate(data.date)}. Contact the owner if you need to make changes.`);
        } else {
          setMsg(error.message);
        }
        return;
      }
      if (inserted?.id) await upsertShortOver(inserted.id);
      await logActivity(supabase, profile, {
        action: 'create',
        entityType: 'daily_sales',
        entityId: inserted?.id,
        description: `${profile?.name} added daily sale of ${fmtMoney(data.r1_gross + data.r2_gross)} for ${storeName} on ${shortDate(data.date)}`,
        storeName,
      });
    }

    setModal(null); setEditItem(null);
    setMsg('success'); setTimeout(() => setMsg(''), 2500);
    setForm(blankForm());
    setActiveTab('r1');
    load();
  };

  const handleDelete = (id) => {
    const row = sales.find(s => s.id === id);
    if (!row) return;
    setConfirmDelete(row);
  };

  const confirmDeleteSale = async () => {
    const row = confirmDelete;
    if (!row) return;
    const { error } = await supabase.from('daily_sales').delete().eq('id', row.id);
    if (error) { setMsg(error.message); setConfirmDelete(null); return; }
    const storeName = row.stores?.name || stores.find(s => s.id === row.store_id)?.name;
    await logActivity(supabase, profile, {
      action: 'delete',
      entityType: 'daily_sales',
      entityId: row.id,
      description: `${profile?.name} deleted daily sale of ${fmtMoney(row.total_sales)} for ${storeName} on ${shortDate(row.date)}`,
      storeName,
      metadata: { deleted: row },
    });
    setConfirmDelete(null);
    load();
  };

  const handleExport = () => {
    const sn = id => stores.find(s => s.id === id)?.name || '';
    downloadCSV(`sales_${range.start}_${range.end}.csv`,
      ['Date', 'Store', 'R1 Cash', 'R1 Card', 'R2 Cash', 'R2 Card', 'Gross', 'Net', 'Credits', 'Short/Over', 'Tax'],
      sales.map(s => [
        s.date, sn(s.store_id),
        s.cash_sales, s.card_sales,
        s.register2_cash || 0, s.register2_card || 0,
        s.gross_sales ?? s.total_sales,
        s.net_sales ?? ((s.gross_sales ?? s.total_sales) - (s.credits || 0)),
        s.credits, s.short_over || 0, s.tax_collected,
      ])
    );
  };

  // Live-derived numbers for the Summary tab.
  const num = (v) => parseFloat(v) || 0;
  const r1Gross        = num(form.r1_gross);
  const r1Net          = num(form.r1_net);
  const r1Cash         = num(form.cash_sales);
  const r1Card         = num(form.card_sales);
  const r1CancelBasket = num(form.r1_canceled_basket);
  const r1SafeDrop     = num(form.r1_safe_drop);
  const r1SalesTax     = num(form.r1_sales_tax);
  const r1Credits      = num(form.credits);

  const r2Net          = num(form.r2_net);
  const r2Cash         = num(form.register2_cash);
  const r2SafeDrop     = num(form.r2_safe_drop);

  // Determine register 2 applicability first — short/over total depends on it.
  const currentStoreObj = stores.find(s => s.id === (isEmployee ? profile?.store_id : effectiveStoreId));
  const currentUsesReg2 = hasRegister2(currentStoreObj?.name);

  // Short/over — positive = SHORT, negative = OVER.
  //   r1 = cash sales - safe drop (employee handed in less cash than register)
  //   r2 = net sales - safe drop
  //   diff = canceled basket - r2 net sales
  //   total = r1 + r2 + diff  (r2 + diff only added for R2 stores)
  const r1ShortOverCalc = r1Cash - r1SafeDrop;
  const r2ShortOverCalc = r2Net - r2SafeDrop;
  const basketVsR2NetDiff = r1CancelBasket - r2Net;
  const totalShortOverCalc = r1ShortOverCalc + (currentUsesReg2 ? r2ShortOverCalc + basketVsR2NetDiff : 0);

  const totalGross = r1Gross + r2Net; // R2 has no gross, use net
  const totalNet   = r1Net + r2Net;
  const totalCash  = r1Cash + r2Cash;
  const totalCard  = r1Card; // R2 has no card

  // Employee "Next →" flow.
  const flowTabs = ['r1', ...(currentUsesReg2 ? ['r2'] : []), 'summary'];
  const curIdx = flowTabs.indexOf(activeTab);
  const nextTabId = curIdx >= 0 && curIdx < flowTabs.length - 1 ? flowTabs[curIdx + 1] : null;
  const isOnSummaryTab = activeTab === 'summary';

  // ── Tabbed register form (shared by employee + owner modal) ──
  const renderTabbedForm = (usesReg2, allowShortOver, dateField) => {
    // For single-register stores (Reno/Denison/Troup), hide R2 completely.
    const tabs = [
      { id: 'r1', label: 'Register 1' },
      ...(usesReg2 ? [{ id: 'r2', label: 'Register 2' }] : []),
      { id: 'summary', label: 'Summary' },
    ];
    const tabIds = tabs.map(t => t.id);
    const currentIdx = tabIds.indexOf(activeTab);
    const nextTabId = currentIdx >= 0 && currentIdx < tabIds.length - 1 ? tabIds[currentIdx + 1] : null;
    const isLastTab = activeTab === 'summary';

    const onNum = (key) => (e) => setForm({ ...form, [key]: e.target.value.replace(/^-/, '') });
    const reqMark = <span className="text-sw-red">*</span>;

    return (
      <div>
        {dateField}
        <div className="flex gap-1 border-b border-sw-border mb-3 -mx-1 px-1">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 px-3 py-2 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors
                ${activeTab === t.id ? 'border-sw-blue text-sw-blue' : 'border-transparent text-sw-sub hover:text-sw-text'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'r1' && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label={<>Gross Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_gross} onChange={onNum('r1_gross')} />
              </Field>
              <Field label={<>Net Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_net} onChange={onNum('r1_net')} />
              </Field>
              <Field label={<>Cash Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.cash_sales} onChange={onNum('cash_sales')} />
              </Field>
              <Field label={<>Card Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.card_sales} onChange={onNum('card_sales')} />
              </Field>
              <Field label={<>Canceled Basket {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_canceled_basket} onChange={onNum('r1_canceled_basket')} />
              </Field>
              <Field label={<>Safe Drop {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_safe_drop} onChange={onNum('r1_safe_drop')} />
              </Field>
              <Field label={<>Sales Tax {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_sales_tax} onChange={onNum('r1_sales_tax')} />
              </Field>
              <Field label="Credits"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.credits} onChange={onNum('credits')} /></Field>
            </div>

            {/* Live R1 short/over preview — Cash Sales minus Safe Drop (positive = short). */}
            {(form.r1_safe_drop !== '' || form.cash_sales !== '') && (
              <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-sw-sub text-[11px] font-semibold uppercase">R1 Short/Over</span>
                {(() => {
                  const v = (parseFloat(form.cash_sales) || 0) - (parseFloat(form.r1_safe_drop) || 0);
                  if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                  if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                  return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'r2' && usesReg2 && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label={<>R2 Net Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_net} onChange={onNum('r2_net')} />
              </Field>
              <Field label={<>Cash {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_cash} onChange={onNum('register2_cash')} />
              </Field>
              <Field label={<>R2 Safe Drop {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_safe_drop} onChange={onNum('r2_safe_drop')} />
              </Field>
            </div>

            {/* Live R2 short/over preview — R2 Net Sales minus R2 Safe Drop. */}
            {(form.r2_safe_drop !== '' || form.r2_net !== '') && (
              <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-sw-sub text-[11px] font-semibold uppercase">R2 Short/Over</span>
                {(() => {
                  const v = (parseFloat(form.r2_net) || 0) - (parseFloat(form.r2_safe_drop) || 0);
                  if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                  if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                  return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-3">
            <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Register 1</div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[11px]">
                <div className="text-sw-sub">Gross</div><div className="text-right font-mono text-sw-text">{fmt(r1Gross)}</div>
                <div className="text-sw-sub">Net</div><div className="text-right font-mono text-sw-text">{fmt(r1Net)}</div>
                <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(r1Cash)}</div>
                <div className="text-sw-sub">Card</div><div className="text-right font-mono">{fmt(r1Card)}</div>
                <div className="text-sw-sub">Canceled Basket</div><div className="text-right font-mono">{fmt(r1CancelBasket)}</div>
                <div className="text-sw-sub">Safe Drop</div><div className="text-right font-mono">{fmt(r1SafeDrop)}</div>
                <div className="text-sw-sub">Sales Tax</div><div className="text-right font-mono text-sw-cyan">{fmt(r1SalesTax)}</div>
                <div className="text-sw-sub">Credits</div><div className="text-right font-mono">{fmt(r1Credits)}</div>
                <div className="text-sw-sub col-span-2 border-t border-sw-border pt-1 mt-1 flex justify-between">
                  <span>Short/Over <span className="text-sw-dim text-[10px]">(Cash − Safe Drop)</span></span>
                  {(() => {
                    if (Math.abs(r1ShortOverCalc) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                    if (r1ShortOverCalc > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(r1ShortOverCalc)}</span>;
                    return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(r1ShortOverCalc))}</span>;
                  })()}
                </div>
              </div>
            </div>

            {usesReg2 && (
              <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Register 2</div>
                <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[11px]">
                  <div className="text-sw-sub">Net</div><div className="text-right font-mono text-sw-text">{fmt(r2Net)}</div>
                  <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(r2Cash)}</div>
                  <div className="text-sw-sub">Safe Drop</div><div className="text-right font-mono">{fmt(r2SafeDrop)}</div>
                  <div className="text-sw-sub col-span-2 border-t border-sw-border pt-1 mt-1 flex justify-between">
                    <span>Short/Over <span className="text-sw-dim text-[10px]">(Net − Safe Drop)</span></span>
                    {(() => {
                      if (Math.abs(r2ShortOverCalc) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                      if (r2ShortOverCalc > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(r2ShortOverCalc)}</span>;
                      return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(r2ShortOverCalc))}</span>;
                    })()}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-sw-blueD border border-sw-blue/30 rounded-lg p-3">
              <div className="text-sw-blue text-[10px] font-bold uppercase mb-1.5">Combined Totals</div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[12px]">
                <div className="text-sw-sub">Total Gross</div><div className="text-right font-mono font-bold">{fmt(totalGross)}</div>
                <div className="text-sw-sub">Total Net</div><div className="text-right font-mono font-bold text-sw-green">{fmt(totalNet)}</div>
                <div className="text-sw-sub">Total Cash</div><div className="text-right font-mono">{fmt(totalCash)}</div>
                <div className="text-sw-sub">Total Card</div><div className="text-right font-mono">{fmt(totalCard)}</div>
              </div>
            </div>

            {/* Short/Over roll-up: R1 + R2 + Basket diff = Total */}
            <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Short / Over Breakdown</div>
              <div className="space-y-1 text-[12px]">
                {(() => {
                  const fmtSO = (v) => {
                    if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono">{fmt(0)}</span>;
                    if (v > 0) return <span className="text-sw-red font-mono font-bold">-{fmt(v)}</span>;
                    return <span className="text-sw-green font-mono font-bold">+{fmt(Math.abs(v))}</span>;
                  };
                  return (
                    <>
                      <div className="flex justify-between">
                        <span className="text-sw-sub">R1 Short/Over <span className="text-sw-dim text-[10px]">(Cash − Safe Drop)</span></span>
                        {fmtSO(r1ShortOverCalc)}
                      </div>
                      {usesReg2 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-sw-sub">R2 Short/Over <span className="text-sw-dim text-[10px]">(Net − Safe Drop)</span></span>
                            {fmtSO(r2ShortOverCalc)}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sw-sub">Basket vs R2 Net <span className="text-sw-dim text-[10px]">(Basket − R2 Net)</span></span>
                            {fmtSO(basketVsR2NetDiff)}
                          </div>
                        </>
                      )}
                      <div className="flex justify-between border-t border-sw-border pt-1.5 mt-1 text-[13px]">
                        <span className="text-sw-text font-bold uppercase tracking-wide">Total Short/Over</span>
                        {(() => {
                          if (Math.abs(totalShortOverCalc) < 0.01) return <span className="text-sw-dim font-mono font-extrabold">Matched {fmt(0)}</span>;
                          if (totalShortOverCalc > 0) return <span className="text-sw-red font-mono font-extrabold">Short -{fmt(totalShortOverCalc)}</span>;
                          return <span className="text-sw-green font-mono font-extrabold">Over +{fmt(Math.abs(totalShortOverCalc))}</span>;
                        })()}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <Field label="Notes"><input placeholder="Optional" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </div>
    );
  };

  // ── Employee simplified view ────────────────────────────
  if (isEmployee) {
    const todayStr = today();
    const todayEntry = sales.find(s => s.date === todayStr && s.store_id === profile?.store_id);
    const storeName = stores.find(s => s.id === profile?.store_id)?.name;
    const empUsesReg2 = hasRegister2(storeName);

    return (
      <div className="max-w-xl mx-auto">
        <PageHeader title="Enter Daily Sales" subtitle={storeName} />
        {msg === 'success' && <Alert type="success">Sales recorded!</Alert>}
        {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

        {todayEntry ? (
          <div className="bg-sw-greenD rounded-xl p-5 border border-sw-green/30 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✅</span>
              <div>
                <div className="text-sw-green text-base font-extrabold">Today's sales have been submitted</div>
                <div className="text-sw-sub text-[11px]">{dayLabel(todayEntry.date)} · {storeName}</div>
              </div>
            </div>

            {/* R1 detail */}
            <div className="bg-sw-card2 rounded-lg p-3 border border-sw-border mb-2">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Register 1</div>
              <div className="grid grid-cols-2 gap-y-0.5 gap-x-2 text-[11px]">
                <div className="text-sw-sub">Gross</div><div className="text-right font-mono">{fmt(todayEntry.r1_gross ?? todayEntry.gross_sales)}</div>
                <div className="text-sw-sub">Net</div><div className="text-right font-mono">{fmt(todayEntry.r1_net ?? todayEntry.net_sales)}</div>
                <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(todayEntry.cash_sales)}</div>
                <div className="text-sw-sub">Card</div><div className="text-right font-mono">{fmt(todayEntry.card_sales)}</div>
                <div className="text-sw-sub">Canceled Basket</div><div className="text-right font-mono">{fmt(todayEntry.r1_canceled_basket || 0)}</div>
                <div className="text-sw-sub">Safe Drop</div><div className="text-right font-mono">{fmt(todayEntry.r1_safe_drop || 0)}</div>
                <div className="text-sw-sub">Sales Tax</div><div className="text-right font-mono text-sw-cyan">{fmt(todayEntry.r1_sales_tax ?? todayEntry.tax_collected ?? 0)}</div>
                <div className="text-sw-sub">Credits</div><div className="text-right font-mono">{fmt(todayEntry.credits || 0)}</div>
                <div className="text-sw-sub col-span-2 border-t border-sw-border pt-1 mt-1 flex justify-between">
                  <span>R1 Short/Over</span>
                  {(() => {
                    const v = Number(todayEntry.r1_short_over || 0);
                    if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched $0.00</span>;
                    if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                    return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                  })()}
                </div>
              </div>
            </div>

            {/* R2 detail */}
            {empUsesReg2 && (
              <div className="bg-sw-card2 rounded-lg p-3 border border-sw-border mb-2">
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Register 2</div>
                <div className="grid grid-cols-2 gap-y-0.5 gap-x-2 text-[11px]">
                  <div className="text-sw-sub">Net</div><div className="text-right font-mono">{fmt(todayEntry.r2_net || 0)}</div>
                  <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(todayEntry.register2_cash || 0)}</div>
                  <div className="text-sw-sub">Safe Drop</div><div className="text-right font-mono">{fmt(todayEntry.r2_safe_drop || 0)}</div>
                  <div className="text-sw-sub col-span-2 border-t border-sw-border pt-1 mt-1 flex justify-between">
                    <span>R2 Short/Over</span>
                    {(() => {
                      const v = Number(todayEntry.r2_short_over || 0);
                      if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched $0.00</span>;
                      if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                      return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Total S/O */}
            <div className="bg-sw-blueD border border-sw-blue/30 rounded-lg p-2.5 flex justify-between items-center">
              <span className="text-sw-blue text-[11px] font-bold uppercase">Total Short/Over</span>
              {(() => {
                const v = Number(todayEntry.short_over || 0);
                if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-extrabold">Matched $0.00</span>;
                if (v > 0) return <span className="text-sw-red font-mono font-extrabold">Short -{fmt(v)}</span>;
                return <span className="text-sw-green font-mono font-extrabold">Over +{fmt(Math.abs(v))}</span>;
              })()}
            </div>

            <p className="text-sw-sub text-[11px] mt-3">
              🔒 Only the owner can edit today's entry. Contact the owner if you need to make a correction.
            </p>
          </div>
        ) : (
          <div className="bg-sw-card rounded-xl p-5 border border-sw-border mb-4">
            {renderTabbedForm(empUsesReg2, /*allowShortOver*/ false, (
              <Field label="Date"><input type="date" value={todayStr} readOnly disabled /></Field>
            ))}
            {isOnSummaryTab ? (
              <Button onClick={handleSave} className="w-full !py-3 !text-sm !rounded-xl mt-4">Submit Sales</Button>
            ) : (
              <Button onClick={() => setActiveTab(nextTabId)} className="w-full !py-3 !text-sm !rounded-xl mt-4">
                Next →
              </Button>
            )}
          </div>
        )}

        <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
          <div className="px-3 py-2 border-b border-sw-border"><h3 className="text-sw-text text-xs font-bold">Recent Entries (read-only)</h3></div>
          <DataTable columns={[
            { key: 'date', label: 'Date', render: v => dayLabel(v) },
            { key: 'gross_sales', label: 'Gross', align: 'right', mono: true, render: (v, r) => fmt(v ?? r.total_sales) },
            { key: 'net_sales', label: 'Net', align: 'right', mono: true, render: (v, r) => <span className="text-sw-green font-bold">{fmt(v ?? (r.total_sales - (r.credits || 0)))}</span> },
            { key: 'short_over', label: 'S/O', align: 'right', mono: true, render: v => {
              const n = Number(v || 0);
              if (Math.abs(n) < 0.01) return <span className="text-sw-dim">—</span>;
              if (n > 0) return <span className="text-sw-red">-{fmt(n)}</span>;
              return <span className="text-sw-green">+{fmt(Math.abs(n))}</span>;
            } },
          ]} rows={sales.slice(0, 14)} isOwner={false} />
        </div>
        <div className="mt-3 p-2 bg-sw-card2 rounded-lg"><p className="text-sw-dim text-[10px]">🔒 Only the owner can edit/delete entries</p></div>
      </div>
    );
  }

  // ── Owner full view ─────────────────────────────────────
  if (loading) return <Loading />;

  const hasStore = !!effectiveStoreId;
  const storeName = stores.find(s => s.id === effectiveStoreId)?.name;

  const ownerUsesReg2 = hasRegister2(storeName);

  const tryOpenAdd = () => {
    if (!hasStore) { setShowStorePicker(true); return; }
    setForm(blankForm());
    setActiveTab('r1');
    setModal('add');
  };

  return (
    <div>
      <PageHeader title="Daily Sales" subtitle={hasStore ? `${storeName} · ${sales.length} entries` : `All Stores · ${sales.length} entries (view only)`}>
        <Button variant="secondary" onClick={handleExport} className="!text-[11px]">📥 CSV</Button>
        <Button onClick={tryOpenAdd}>+ Add</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}
      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable columns={[
          { key: '_mismatch', label: '', align: 'center', render: (_, r) => {
            // Owner-only signal: R1 canceled basket should equal R2 cash-to-cash
            // (that's the money moved from R2 to R1 to cover voided baskets).
            const cb = Number(r.r1_canceled_basket || 0);
            const r2c = Number(r.register2_cash || 0);
            if (cb === 0 && r2c === 0) return null;
            const diff = cb - r2c;
            if (Math.abs(diff) < 0.01) return null;
            return (
              <span
                title={`R1 Canceled Basket (${fmt(cb)}) vs R2 Cash to Cash (${fmt(r2c)}) — mismatch ${fmt(Math.abs(diff))}`}
                className="text-sw-red text-base"
              >
                ⚠️
              </span>
            );
          } },
          { key: 'date', label: 'Date', render: v => dayLabel(v) },
          { key: 'store_id', label: 'Store', render: (v, r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
          { key: 'gross_sales', label: 'Gross', align: 'right', mono: true, render: (v, r) => fmt(v ?? r.total_sales) },
          { key: 'net_sales', label: 'Net', align: 'right', mono: true, render: (v, r) => <span className="text-sw-green font-bold">{fmt(v ?? ((r.gross_sales ?? r.total_sales) - (r.credits || 0)))}</span> },
          { key: 'cash_total', label: 'Cash', align: 'right', mono: true, render: (_, r) => fmt((r.cash_sales || 0) + (r.register2_cash || 0)) },
          { key: 'card_total', label: 'Card', align: 'right', mono: true, render: (_, r) => fmt((r.card_sales || 0) + (r.register2_card || 0)) },
          { key: 'credits', label: 'Credits', align: 'right', mono: true, render: v => fmt(v) },
          { key: 'short_over', label: 'S/O', align: 'right', mono: true, render: v => {
            const n = Number(v || 0);
            if (Math.abs(n) < 0.01) return <span className="text-sw-dim">—</span>;
            // Positive = short (employee owes money) → red.
            // Negative = over → green.
            if (n > 0) return <span className="text-sw-red font-bold">-{fmt(n)}</span>;
            return <span className="text-sw-green font-bold">+{fmt(Math.abs(n))}</span>;
          } },
          { key: '_basket_diff', label: 'Diff', align: 'right', mono: true, render: (_, r) => {
            const cb = Number(r.r1_canceled_basket || 0);
            const r2n = Number(r.r2_net || 0);
            if (cb === 0 && r2n === 0) return <span className="text-sw-dim">—</span>;
            const diff = cb - r2n;
            if (Math.abs(diff) < 0.01) return <span className="text-sw-green">✅</span>;
            if (diff > 0) return <span className="text-sw-amber">+{fmt(diff)}</span>;
            return <span className="text-sw-red">-{fmt(Math.abs(diff))}</span>;
          } },
          { key: 'entered_by', label: 'By', render: (v, r) => <span className="text-sw-sub text-[11px]">{r.profiles?.name || r.profiles?.username || 'Unknown'}</span> },
        ]} rows={sales} isOwner={hasStore}
          onEdit={hasStore ? r => { setForm({
            date: r.date,
            r1_gross: r.r1_gross ?? r.gross_sales ?? '',
            r1_net: r.r1_net ?? r.net_sales ?? '',
            cash_sales: r.cash_sales ?? '',
            card_sales: r.card_sales ?? '',
            r1_canceled_basket: r.r1_canceled_basket ?? '',
            r1_safe_drop: r.r1_safe_drop ?? '',
            r1_sales_tax: r.r1_sales_tax ?? r.tax_collected ?? '',
            credits: r.credits ?? '',
            r2_net: r.r2_net ?? '',
            register2_cash: r.register2_cash ?? '',
            r2_safe_drop: r.r2_safe_drop ?? '',
            notes: r.notes || '',
          }); setEditItem(r); setActiveTab('r1'); setModal('edit'); } : undefined}
          onDelete={hasStore ? handleDelete : undefined} />
      </div>

      {modal && (
        <Modal title={modal === 'edit' ? 'Edit Sale' : 'Add Sale'} onClose={() => { setModal(null); setEditItem(null); }}>
          <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
            Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
          </div>
          {renderTabbedForm(ownerUsesReg2, /*allowShortOver*/ true, (
            <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          ))}
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); }}>Cancel</Button>
            <Button onClick={handleSave}>{modal === 'edit' ? 'Update' : 'Save'}</Button>
          </div>
        </Modal>
      )}

      {showStorePicker && (
        <StoreRequiredModal
          stores={stores}
          onCancel={() => setShowStorePicker(false)}
          onSelectStore={(s) => {
            setSelectedStore(s.id);
            setShowStorePicker(false);
            setForm(blankForm());
            setActiveTab('r1');
            setModal('add');
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Are you sure you want to delete this sale?"
          message={
            <>
              <div className="mb-1"><span className="text-sw-sub">Store: </span><span className="text-sw-text font-semibold">{confirmDelete.stores?.name || stores.find(s => s.id === confirmDelete.store_id)?.name || '—'}</span></div>
              <div className="mb-1"><span className="text-sw-sub">Date: </span><span className="text-sw-text font-semibold">{shortDate(confirmDelete.date)}</span></div>
              <div className="mb-3"><span className="text-sw-sub">Total: </span><span className="text-sw-green font-extrabold font-mono">{fmtMoney(confirmDelete.total_sales)}</span></div>
              <div className="text-sw-sub text-[12px]">This action will be logged in the Activity Log and cannot be undone.</div>
            </>
          }
          confirmLabel="Yes, Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={confirmDeleteSale}
        />
      )}
    </div>
  );
}
