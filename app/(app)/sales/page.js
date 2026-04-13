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
    // Register 1 — manual entry
    r1_gross: '', r1_net: '', cash_sales: '', card_sales: '', credits: '',
    // Register 2 — manual entry
    r2_gross: '', r2_net: '', register2_cash: '', register2_card: '', register2_credits: '',
    // Owner-only short/over
    r1_short_over: '', r2_short_over: '',
    notes: '',
  });

  const blankForm = () => ({
    date: today(),
    r1_gross: '', r1_net: '', cash_sales: '', card_sales: '', credits: '',
    r2_gross: '', r2_net: '', register2_cash: '', register2_card: '', register2_credits: '',
    r1_short_over: '', r2_short_over: '',
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
          .select('id, name, role')
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

    // Required field check for Register 1
    if (form.r1_gross === '' || form.r1_net === '' || form.cash_sales === '' || form.card_sales === '') {
      setMsg('Register 1: Gross, Net, Cash, and Card are all required.');
      setActiveTab('r1');
      return;
    }
    if (usesReg2 && (form.r2_gross === '' || form.r2_net === '' || form.register2_cash === '' || form.register2_card === '')) {
      setMsg('Register 2: Gross, Net, Cash, and Card are all required.');
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
      credits: num(form.credits),
      // Register 2 (zeros for stores without it)
      r2_gross: usesReg2 ? num(form.r2_gross) : 0,
      r2_net: usesReg2 ? num(form.r2_net) : 0,
      register2_cash: usesReg2 ? num(form.register2_cash) : 0,
      register2_card: usesReg2 ? num(form.register2_card) : 0,
      register2_credits: usesReg2 ? num(form.register2_credits) : 0,
      // Short/over — owner only
      r1_short_over: isOwner ? num(form.r1_short_over) : 0,
      r2_short_over: isOwner && usesReg2 ? num(form.r2_short_over) : 0,
      notes: form.notes,
      entered_by: profile.id,
    };

    const storeName = stores.find(s => s.id === data.store_id)?.name;
    const total = data.cash_sales + data.card_sales;

    if (modal === 'edit' && editItem) {
      const { error } = await supabase.from('daily_sales').update(data).eq('id', editItem.id);
      if (error) { setMsg(error.message); return; }
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
  const r1Gross = num(form.r1_gross);
  const r1Net = num(form.r1_net);
  const r1Cash = num(form.cash_sales);
  const r1Card = num(form.card_sales);
  const r1Credits = num(form.credits);
  const r2Gross = num(form.r2_gross);
  const r2Net = num(form.r2_net);
  const r2Cash = num(form.register2_cash);
  const r2Card = num(form.register2_card);
  const r2Credits = num(form.register2_credits);
  const r1ShortOver = num(form.r1_short_over);
  const r2ShortOver = num(form.r2_short_over);

  // Mismatch detection — anti-theft signal.
  const r1Diff = (r1Cash + r1Card) - r1Gross;
  const r2Diff = (r2Cash + r2Card) - r2Gross;
  const r1Mismatch = Math.abs(r1Diff) >= 0.01;
  const r2Mismatch = Math.abs(r2Diff) >= 0.01;

  const totalGross = r1Gross + r2Gross;
  const totalNet = r1Net + r2Net;
  const totalCash = r1Cash + r2Cash;
  const totalCard = r1Card + r2Card;
  const totalCredits = r1Credits + r2Credits;
  const totalShortOver = r1ShortOver + r2ShortOver;

  // ── Tabbed register form (shared by employee + owner modal) ──
  const renderTabbedForm = (usesReg2, allowShortOver, dateField) => {
    const tabs = [
      { id: 'r1', label: 'Register 1' },
      ...(usesReg2 ? [{ id: 'r2', label: 'Register 2' }] : []),
      { id: 'summary', label: 'Summary' },
    ];

    const onNum = (key) => (e) => setForm({ ...form, [key]: e.target.value.replace(/^-/, '') });
    const reqMark = <span className="text-sw-red">*</span>;

    return (
      <div>
        {dateField}
        <div className="flex gap-1 border-b border-sw-border mb-3 -mx-1 px-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors
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
            </div>
            <Field label="Credits"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.credits} onChange={onNum('credits')} /></Field>
            {r1Mismatch && (r1Cash || r1Card || r1Gross) > 0 && (
              <div className="rounded-lg border border-sw-red/30 bg-sw-redD text-sw-red text-[11px] p-2">
                ⚠️ Cash ({fmt(r1Cash)}) + Card ({fmt(r1Card)}) = {fmt(r1Cash + r1Card)} but Gross was entered as {fmt(r1Gross)} — mismatch of {fmt(Math.abs(r1Diff))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'r2' && usesReg2 && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label={<>R2 Gross Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_gross} onChange={onNum('r2_gross')} />
              </Field>
              <Field label={<>R2 Net Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_net} onChange={onNum('r2_net')} />
              </Field>
              <Field label={<>R2 Cash Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_cash} onChange={onNum('register2_cash')} />
              </Field>
              <Field label={<>R2 Card Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_card} onChange={onNum('register2_card')} />
              </Field>
            </div>
            <Field label="R2 Credits"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_credits} onChange={onNum('register2_credits')} /></Field>
            {r2Mismatch && (r2Cash || r2Card || r2Gross) > 0 && (
              <div className="rounded-lg border border-sw-red/30 bg-sw-redD text-sw-red text-[11px] p-2">
                ⚠️ R2 Cash ({fmt(r2Cash)}) + Card ({fmt(r2Card)}) = {fmt(r2Cash + r2Card)} but Gross was entered as {fmt(r2Gross)} — mismatch of {fmt(Math.abs(r2Diff))}
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
                <div className="text-sw-sub">Credits</div><div className="text-right font-mono">{fmt(r1Credits)}</div>
              </div>
              {r1Mismatch && (r1Cash || r1Card || r1Gross) > 0 && (
                <div className="mt-2 rounded border border-sw-red/30 bg-sw-redD text-sw-red text-[10px] p-1.5">
                  ⚠️ Cash + Card ({fmt(r1Cash + r1Card)}) ≠ Gross ({fmt(r1Gross)}) — mismatch {fmt(Math.abs(r1Diff))}
                </div>
              )}
            </div>

            {usesReg2 && (
              <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Register 2</div>
                <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[11px]">
                  <div className="text-sw-sub">Gross</div><div className="text-right font-mono text-sw-text">{fmt(r2Gross)}</div>
                  <div className="text-sw-sub">Net</div><div className="text-right font-mono text-sw-text">{fmt(r2Net)}</div>
                  <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(r2Cash)}</div>
                  <div className="text-sw-sub">Card</div><div className="text-right font-mono">{fmt(r2Card)}</div>
                  <div className="text-sw-sub">Credits</div><div className="text-right font-mono">{fmt(r2Credits)}</div>
                </div>
                {r2Mismatch && (r2Cash || r2Card || r2Gross) > 0 && (
                  <div className="mt-2 rounded border border-sw-red/30 bg-sw-redD text-sw-red text-[10px] p-1.5">
                    ⚠️ Cash + Card ({fmt(r2Cash + r2Card)}) ≠ Gross ({fmt(r2Gross)}) — mismatch {fmt(Math.abs(r2Diff))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-sw-blueD border border-sw-blue/30 rounded-lg p-3">
              <div className="text-sw-blue text-[10px] font-bold uppercase mb-1.5">Combined Totals</div>
              <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[12px]">
                <div className="text-sw-sub">Gross</div><div className="text-right font-mono font-bold">{fmt(totalGross)}</div>
                <div className="text-sw-sub">Net</div><div className="text-right font-mono font-bold text-sw-green">{fmt(totalNet)}</div>
                <div className="text-sw-sub">Cash</div><div className="text-right font-mono">{fmt(totalCash)}</div>
                <div className="text-sw-sub">Card</div><div className="text-right font-mono">{fmt(totalCard)}</div>
                <div className="text-sw-sub">Credits</div><div className="text-right font-mono">{fmt(totalCredits)}</div>
              </div>
            </div>

            {allowShortOver && (
              <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Short / Over (owner only)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="R1 Short / Over"><input type="number" step="0.01" placeholder="0.00" value={form.r1_short_over} onChange={(e) => setForm({ ...form, r1_short_over: e.target.value })} /></Field>
                  {usesReg2 && <Field label="R2 Short / Over"><input type="number" step="0.01" placeholder="0.00" value={form.r2_short_over} onChange={(e) => setForm({ ...form, r2_short_over: e.target.value })} /></Field>}
                </div>
                <div className="text-[11px] text-sw-sub mt-1">Total S/O: <span className={totalShortOver === 0 ? 'text-sw-dim' : totalShortOver < 0 ? 'text-sw-red font-bold' : 'text-sw-green font-bold'}>{totalShortOver >= 0 ? '+' : ''}{fmt(totalShortOver)}</span></div>
              </div>
            )}

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
            <div className="grid grid-cols-2 gap-2 bg-sw-card2 rounded-lg p-3 border border-sw-border">
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase">Cash</div>
                <div className="text-sw-text font-mono font-bold">{fmt(todayEntry.cash_sales)}</div>
              </div>
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase">Card</div>
                <div className="text-sw-text font-mono font-bold">{fmt(todayEntry.card_sales)}</div>
              </div>
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase">Credits</div>
                <div className="text-sw-text font-mono">{fmt(todayEntry.credits || 0)}</div>
              </div>
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase">Total</div>
                <div className="text-sw-green font-mono font-extrabold">{fmt(todayEntry.total_sales)}</div>
              </div>
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
            <Button onClick={handleSave} className="w-full !py-3 !text-sm !rounded-xl mt-4">Submit Sales</Button>
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
              if (n === 0) return <span className="text-sw-dim">—</span>;
              return <span className={n < 0 ? 'text-sw-red' : 'text-sw-green'}>{n > 0 ? '+' : ''}{fmt(n)}</span>;
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
            const declared = Number(r.gross_sales || 0);
            const actual = (Number(r.cash_sales || 0) + Number(r.card_sales || 0))
                         + (Number(r.register2_cash || 0) + Number(r.register2_card || 0));
            const diff = actual - declared;
            if (declared === 0 || Math.abs(diff) < 0.01) return null;
            return (
              <span title={`Cash+Card (${fmt(actual)}) ≠ Gross (${fmt(declared)}) — diff ${fmt(Math.abs(diff))}`} className="text-sw-red text-base">⚠️</span>
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
            if (n === 0) return <span className="text-sw-dim">—</span>;
            return <span className={n < 0 ? 'text-sw-red font-bold' : 'text-sw-green font-bold'}>{n > 0 ? '+' : ''}{fmt(n)}</span>;
          } },
          { key: 'entered_by', label: 'By', render: (v, r) => <span className="text-sw-sub text-[11px]">{r.profiles?.name || '—'}</span> },
        ]} rows={sales} isOwner={hasStore}
          onEdit={hasStore ? r => { setForm({
            date: r.date,
            r1_gross: r.r1_gross ?? r.gross_sales ?? '', r1_net: r.r1_net ?? r.net_sales ?? '',
            cash_sales: r.cash_sales ?? '', card_sales: r.card_sales ?? '',
            credits: r.credits ?? '',
            r2_gross: r.r2_gross ?? '', r2_net: r.r2_net ?? '',
            register2_cash: r.register2_cash ?? '', register2_card: r.register2_card ?? '',
            register2_credits: r.register2_credits ?? '',
            r1_short_over: r.r1_short_over ?? '', r2_short_over: r.r2_short_over ?? '',
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
