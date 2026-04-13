'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Alert, Loading, StoreBadge, ConfirmModal, StoreRequiredModal } from '@/components/UI';
import { fmt, fK, dayLabel, today, downloadCSV, hasRegister2 } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';
import { uploadReceipt, compressImage } from '@/lib/storage';

export default function SalesPage() {
  const { supabase, isOwner, isEmployee, profile, effectiveStoreId } = useAuth();
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
  // Local form-only store id. Used when the owner picks a store for a
  // specific Add entry while "All Stores" is selected in the sidebar.
  // This is NEVER written back to the sidebar's selectedStore.
  const [formStoreId, setFormStoreId] = useState(null);
  const [modalError, setModalError] = useState('');              // banner text shown inside the modal/form
  const [fieldErrors, setFieldErrors] = useState({});           // { fieldName: true }
  // Receipt upload state — simple image storage for record keeping, no AI.
  // R1 = Register 1 shift report (saved to shift_report_url)
  // R2 = Register 2 shift report (saved to safe_drop_url for back-compat)
  const [shiftReportFile, setShiftReportFile] = useState(null);
  const [shiftReportPreview, setShiftReportPreview] = useState(null);
  const [r2ReportFile, setR2ReportFile] = useState(null);
  const [r2ReportPreview, setR2ReportPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const shiftCameraRef = useRef(null);
  const shiftLibraryRef = useRef(null);
  const r2CameraRef = useRef(null);
  const r2LibraryRef = useRef(null);
  // Receipt view modal (click 📷 in the owner table).
  const [viewReceipts, setViewReceipts] = useState(null); // { r1Url, r2Url, storeName, date }
  const [viewReceipt, setViewReceipt] = useState(null); // { url, caption } for full-screen viewer
  const [activeTab, setActiveTab] = useState('r1'); // 'r1' | 'r2' | 'summary'
  const [form, setForm] = useState({
    date: today(),
    // Register 1
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    cashapp_check: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    r1_house_account_choice: '',
    r1_house_account_custom: '',
    r1_house_account_amount: '',
    // Register 2 (Bells/Kerens)
    r2_net: '',
    register2_cash: '',
    r2_safe_drop: '',
    notes: '',
  });

  const blankForm = () => ({
    date: today(),
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    cashapp_check: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    r1_house_account_choice: '',
    r1_house_account_custom: '',
    r1_house_account_amount: '',
    r2_net: '',
    register2_cash: '',
    r2_safe_drop: '',
    notes: '',
  });

  // Resolve the saved house account name from the dropdown + custom input.
  const resolvedHouseAccountName = () => {
    const c = form.r1_house_account_choice;
    if (c === 'billy') return 'Billy';
    if (c === 'elias') return 'Elias';
    if (c === 'other') return (form.r1_house_account_custom || '').trim() || null;
    return null;
  };

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

  const pickFile = (setter, previewSetter) => async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setter(f);
    const reader = new FileReader();
    reader.onload = (ev) => previewSetter(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleShiftPick = pickFile(setShiftReportFile, setShiftReportPreview);
  const handleR2Pick = pickFile(setR2ReportFile, setR2ReportPreview);

  const handleSave = async () => {
    const num = (v) => parseFloat(v) || 0;
    // When editing, the target is always the row's own store so an owner
    // can edit any row regardless of current sidebar selection. For new
    // entries, the sidebar or a form-local picked store is used.
    const storeIdToUse = isEmployee
      ? profile.store_id
      : (editItem?.store_id || effectiveStoreId || formStoreId);
    if (!storeIdToUse) {
      setMsg('Please select a store from the sidebar first.');
      return;
    }
    const storeForRegister = stores.find(s => s.id === storeIdToUse);
    const usesReg2 = hasRegister2(storeForRegister?.name);

    // ── Validation ─────────────────────────────────────────────
    const errs = {};
    const r1Required = ['r1_gross', 'r1_net', 'cash_sales', 'card_sales', 'cashapp_check', 'r1_canceled_basket', 'r1_safe_drop', 'r1_sales_tax'];
    r1Required.forEach(k => { if (form[k] === '') errs[k] = true; });

    if (usesReg2) {
      if (form.r2_net === '')          errs.r2_net = true;
      if (form.register2_cash === '')  errs.register2_cash = true;
      if (form.r2_safe_drop === '')    errs.r2_safe_drop = true;
    }

    // House account: if amount > 0, a name is required.
    if (num(form.r1_house_account_amount) > 0) {
      if (!resolvedHouseAccountName()) {
        errs.r1_house_account_choice = true;
        if (form.r1_house_account_choice === 'other') {
          errs.r1_house_account_custom = true;
        }
      }
    }

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setModalError('Please fill all required fields.');
      // Jump to whichever tab has the first error.
      if (errs.r2_net || errs.register2_cash || errs.r2_safe_drop) {
        setActiveTab('r2');
      } else {
        setActiveTab('r1');
      }
      return;
    }
    setFieldErrors({});
    setModalError('');

    // ── Receipt screenshot — required for employee, optional for owner ──
    const hasReceipt = !!shiftReportFile;
    if (isEmployee && !hasReceipt) {
      setModalError('Please upload the Register Shift Report screenshot before submitting.');
      setActiveTab('r1');
      return;
    }

    // ── Employee must also upload R2 receipt if their store has R2 ──
    if (isEmployee && usesReg2 && !r2ReportFile) {
      setModalError('Please upload the Register 2 receipt screenshot before submitting.');
      setActiveTab('r2');
      return;
    }

    // ── Upload receipts to storage (simple, no AI) ──
    let receiptShiftUrl = null, receiptShiftPath = null;
    let receiptR2Url = null, receiptR2Path = null;
    const storeForPath = stores.find(s => s.id === storeIdToUse);

    setSaving(true);
    try {
      if (shiftReportFile) {
        const shiftCompressed = await compressImage(shiftReportFile);
        const shiftUp = await uploadReceipt(supabase, shiftCompressed, {
          storeName: storeForPath?.name, date: form.date || today(), kind: 'shift',
        });
        receiptShiftUrl = shiftUp.url;
        receiptShiftPath = shiftUp.path;
      }
      if (r2ReportFile) {
        const r2Compressed = await compressImage(r2ReportFile);
        const r2Up = await uploadReceipt(supabase, r2Compressed, {
          storeName: storeForPath?.name, date: form.date || today(), kind: 'r2',
        });
        receiptR2Url = r2Up.url;
        receiptR2Path = r2Up.path;
      }
    } catch (e) {
      setSaving(false);
      setModalError(`Failed to upload receipt: ${e.message || e}`);
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
      cashapp_check: num(form.cashapp_check),
      r1_canceled_basket: num(form.r1_canceled_basket),
      r1_safe_drop: num(form.r1_safe_drop),
      r1_sales_tax: num(form.r1_sales_tax),
      r1_house_account_name: resolvedHouseAccountName(),
      r1_house_account_amount: num(form.r1_house_account_amount),
      // `credits` is kept in sync by the DB trigger but we also send it here
      // for clients/reports that read it directly.
      credits: num(form.r1_house_account_amount),
      // Register 2 (zeros for single-register stores)
      r2_net: usesReg2 ? num(form.r2_net) : 0,
      r2_gross: usesReg2 ? num(form.r2_net) : 0, // legacy column kept in sync
      register2_cash: usesReg2 ? num(form.register2_cash) : 0,
      r2_safe_drop: usesReg2 ? num(form.r2_safe_drop) : 0,
      register2_card: 0,
      register2_credits: 0,
      // Receipts — plain image storage, no AI. On edit without a new file
      // uploaded, preserve the existing URLs on the row.
      shift_report_url: receiptShiftUrl ?? editItem?.shift_report_url ?? null,
      shift_report_path: receiptShiftPath ?? editItem?.shift_report_path ?? null,
      safe_drop_url: receiptR2Url ?? editItem?.safe_drop_url ?? null,   // reused for R2 receipt
      safe_drop_path: receiptR2Path ?? editItem?.safe_drop_path ?? null,
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
          setModalError(`Sales already entered for ${storeName || 'this store'} on ${shortDate(data.date)}. Contact the owner to make changes.`);
          return;
        }
      }

      const { data: inserted, error } = await supabase.from('daily_sales').insert(data).select().single();
      if (error) {
        // Postgres unique_violation. Translate the raw error into a clear message.
        if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
          setModalError(`Sales already entered for ${storeName || 'this store'} on ${shortDate(data.date)}. ${isOwner ? 'Use Edit on the existing row to change it.' : 'Contact the owner to make changes.'}`);
        } else {
          setModalError(error.message);
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

    setSaving(false);
    setModal(null); setEditItem(null);
    setMsg('success'); setTimeout(() => setMsg(''), 2500);
    setForm(blankForm());
    setActiveTab('r1');
    setFieldErrors({});
    setModalError('');
    setFormStoreId(null);
    setShiftReportFile(null); setShiftReportPreview(null);
    setR2ReportFile(null); setR2ReportPreview(null);
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

  // Open the edit modal with form pre-filled from a sales row.
  const openEditRow = (r) => {
    const nm = (r.r1_house_account_name || '').trim();
    let choice = '';
    let customName = '';
    if (nm.toLowerCase() === 'billy') choice = 'billy';
    else if (nm.toLowerCase() === 'elias') choice = 'elias';
    else if (nm) { choice = 'other'; customName = nm; }
    setForm({
      date: r.date,
      r1_gross: r.r1_gross ?? r.gross_sales ?? '',
      r1_net: r.r1_net ?? r.net_sales ?? '',
      cash_sales: r.cash_sales ?? '',
      card_sales: r.card_sales ?? '',
      cashapp_check: r.cashapp_check ?? '',
      r1_canceled_basket: r.r1_canceled_basket ?? '',
      r1_safe_drop: r.r1_safe_drop ?? '',
      r1_sales_tax: r.r1_sales_tax ?? r.tax_collected ?? '',
      r1_house_account_choice: choice,
      r1_house_account_custom: customName,
      r1_house_account_amount: r.r1_house_account_amount ?? r.credits ?? '',
      r2_net: r.r2_net ?? '',
      register2_cash: r.register2_cash ?? '',
      r2_safe_drop: r.r2_safe_drop ?? '',
      notes: r.notes || '',
    });
    setEditItem(r);
    setActiveTab('r1');
    setFieldErrors({});
    setModalError('');
    resetReceipts();
    setModal('edit');
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
  const r1HouseAmount  = num(form.r1_house_account_amount);
  const r1HouseName    = resolvedHouseAccountName();
  // Legacy alias used by the table display code.
  const r1Credits      = r1HouseAmount;

  const r2Net          = num(form.r2_net);
  const r2Cash         = num(form.register2_cash);
  const r2SafeDrop     = num(form.r2_safe_drop);

  // Determine the currently-targeted store for form logic (R2 visibility,
  // banner label, save destination). Order of precedence:
  //   - employees: always their own assigned store
  //   - when editing a row: the row's store_id
  //   - otherwise: sidebar-selected store, then the form-local picked store
  const currentStoreId = isEmployee
    ? profile?.store_id
    : (editItem?.store_id || effectiveStoreId || formStoreId);
  const currentStoreObj = stores.find(s => s.id === currentStoreId);
  const currentUsesReg2 = hasRegister2(currentStoreObj?.name);

  // Short/over — positive = SHORT (red), negative = OVER (green).
  //   r1 = cash_sales - (r1_safe_drop + r1_house_account_amount)
  //   r2 = r2_net - r2_safe_drop
  //   Basket diff is tracked separately and NOT rolled into total_short.
  const r1ShortOverCalc = r1Cash - (r1SafeDrop + r1HouseAmount);
  const r2ShortOverCalc = r2Net - r2SafeDrop;
  const basketR2Diff = r2Net - r1CancelBasket;
  const totalShortOverCalc = r1ShortOverCalc + (currentUsesReg2 ? r2ShortOverCalc : 0);

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
    // Red border + "Required" text when a field is flagged.
    const errCls = (name) => fieldErrors[name] ? '!border-sw-red' : '';
    const errHint = (name) => fieldErrors[name]
      ? <p className="text-sw-red text-[10px] mt-0.5">Required</p>
      : null;

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
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_gross} onChange={onNum('r1_gross')} className={errCls('r1_gross')} />
                {errHint('r1_gross')}
              </Field>
              <Field label={<>Net Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_net} onChange={onNum('r1_net')} className={errCls('r1_net')} />
                {errHint('r1_net')}
              </Field>
              <Field label={<>Cash Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.cash_sales} onChange={onNum('cash_sales')} className={errCls('cash_sales')} />
                {errHint('cash_sales')}
              </Field>
              <Field label={<>Card Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.card_sales} onChange={onNum('card_sales')} className={errCls('card_sales')} />
                {errHint('card_sales')}
              </Field>
              <Field label={<>CashApp / Check {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.cashapp_check} onChange={onNum('cashapp_check')} className={errCls('cashapp_check')} />
                {errHint('cashapp_check')}
              </Field>
              <Field label={<>Canceled Basket {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_canceled_basket} onChange={onNum('r1_canceled_basket')} className={errCls('r1_canceled_basket')} />
                {errHint('r1_canceled_basket')}
              </Field>
              <Field label={<>Safe Drop {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_safe_drop} onChange={onNum('r1_safe_drop')} className={errCls('r1_safe_drop')} />
                {errHint('r1_safe_drop')}
              </Field>
              <Field label={<>Sales Tax {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_sales_tax} onChange={onNum('r1_sales_tax')} className={errCls('r1_sales_tax')} />
                {errHint('r1_sales_tax')}
              </Field>
            </div>

            {/* House Account — dropdown + amount */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">House Account</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Name">
                  <select
                    value={form.r1_house_account_choice}
                    onChange={(e) => setForm({ ...form, r1_house_account_choice: e.target.value, r1_house_account_custom: e.target.value === 'other' ? form.r1_house_account_custom : '' })}
                    className={errCls('r1_house_account_choice')}
                  >
                    <option value="">Select name…</option>
                    <option value="billy">Billy</option>
                    <option value="elias">Elias</option>
                    <option value="other">Other…</option>
                  </select>
                  {fieldErrors.r1_house_account_choice && (
                    <p className="text-sw-red text-[10px] mt-0.5">Required when amount is entered</p>
                  )}
                </Field>
                <Field label="Amount">
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r1_house_account_amount} onChange={onNum('r1_house_account_amount')} />
                </Field>
              </div>
              {form.r1_house_account_choice === 'other' && (
                <Field label="Custom Name">
                  <input
                    type="text"
                    placeholder="Enter name"
                    value={form.r1_house_account_custom}
                    onChange={(e) => setForm({ ...form, r1_house_account_custom: e.target.value })}
                    className={errCls('r1_house_account_custom')}
                  />
                  {errHint('r1_house_account_custom')}
                </Field>
              )}
            </div>

            {/* Live R1 short/over preview — Cash Sales − (Safe Drop + House Account). */}
            {(form.r1_safe_drop !== '' || form.cash_sales !== '') && (
              <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-sw-sub text-[11px] font-semibold uppercase">R1 Short/Over</span>
                {(() => {
                  const v = (parseFloat(form.cash_sales) || 0)
                          - ((parseFloat(form.r1_safe_drop) || 0) + (parseFloat(form.r1_house_account_amount) || 0));
                  if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                  if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                  return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                })()}
              </div>
            )}

            {/* R1 receipt upload */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5 flex items-center gap-2">
                <span>📷 Register 1 Shift Report</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${isEmployee ? 'bg-sw-red/20 text-sw-red' : 'bg-sw-card text-sw-dim'}`}>
                  {isEmployee ? 'Required' : 'Optional'}
                </span>
              </div>
              {/* Show existing stored receipt when editing and no new file picked */}
              {!shiftReportPreview && editItem?.shift_report_url && (
                <div className="mb-2">
                  <div className="text-sw-dim text-[10px] mb-1">Currently stored:</div>
                  <img src={editItem.shift_report_url} alt="Stored R1 receipt" className="max-h-32 w-full object-contain rounded-lg border border-sw-border bg-black/20" />
                </div>
              )}
              {!shiftReportPreview ? (
                <div className="flex gap-2 flex-col sm:flex-row">
                  <button
                    type="button"
                    onClick={() => shiftCameraRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                  >
                    <span className="text-lg">📷</span><span>Take Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftLibraryRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                  >
                    <span className="text-lg">📁</span><span>From Library</span>
                  </button>
                  <input ref={shiftCameraRef} type="file" accept="image/*" capture="environment" onChange={handleShiftPick} className="hidden" />
                  <input ref={shiftLibraryRef} type="file" accept="image/*" onChange={handleShiftPick} className="hidden" />
                </div>
              ) : (
                <div className="space-y-1">
                  <img src={shiftReportPreview} alt="Shift report preview" className="max-h-32 w-full object-contain rounded-lg border border-sw-border bg-black/20" />
                  <button type="button" onClick={() => { setShiftReportFile(null); setShiftReportPreview(null); setVerifyStage('idle'); }}
                    className="text-sw-red text-[11px] font-semibold underline min-h-[30px]">Remove</button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'r2' && usesReg2 && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label={<>R2 Net Sales {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_net} onChange={onNum('r2_net')} className={errCls('r2_net')} />
                {errHint('r2_net')}
              </Field>
              <Field label={<>Cash {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_cash} onChange={onNum('register2_cash')} className={errCls('register2_cash')} />
                {errHint('register2_cash')}
              </Field>
              <Field label={<>R2 Safe Drop {reqMark}</>}>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.r2_safe_drop} onChange={onNum('r2_safe_drop')} className={errCls('r2_safe_drop')} />
                {errHint('r2_safe_drop')}
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

            {/* R2 receipt upload */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5 flex items-center gap-2">
                <span>📷 Register 2 Report</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${isEmployee ? 'bg-sw-red/20 text-sw-red' : 'bg-sw-card text-sw-dim'}`}>
                  {isEmployee ? 'Required' : 'Optional'}
                </span>
              </div>
              {!r2ReportPreview && editItem?.safe_drop_url && (
                <div className="mb-2">
                  <div className="text-sw-dim text-[10px] mb-1">Currently stored:</div>
                  <img src={editItem.safe_drop_url} alt="Stored R2 receipt" className="max-h-32 w-full object-contain rounded-lg border border-sw-border bg-black/20" />
                </div>
              )}
              {!r2ReportPreview ? (
                <div className="flex gap-2 flex-col sm:flex-row">
                  <button
                    type="button"
                    onClick={() => r2CameraRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                  >
                    <span className="text-lg">📷</span><span>Take Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => r2LibraryRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                  >
                    <span className="text-lg">📁</span><span>From Library</span>
                  </button>
                  <input ref={r2CameraRef} type="file" accept="image/*" capture="environment" onChange={handleR2Pick} className="hidden" />
                  <input ref={r2LibraryRef} type="file" accept="image/*" onChange={handleR2Pick} className="hidden" />
                </div>
              ) : (
                <div className="space-y-1">
                  <img src={r2ReportPreview} alt="R2 receipt preview" className="max-h-32 w-full object-contain rounded-lg border border-sw-border bg-black/20" />
                  <button type="button" onClick={() => { setR2ReportFile(null); setR2ReportPreview(null); }}
                    className="text-sw-red text-[11px] font-semibold underline min-h-[30px]">Remove</button>
                </div>
              )}
            </div>
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
                <div className="text-sw-sub">House Account</div>
                <div className="text-right font-mono">
                  {r1HouseAmount > 0
                    ? <span className="text-sw-text">{r1HouseName || 'Unnamed'} · {fmt(r1HouseAmount)}</span>
                    : <span className="text-sw-dim">None · {fmt(0)}</span>}
                </div>
                <div className="text-sw-sub col-span-2 border-t border-sw-border pt-1 mt-1 flex justify-between">
                  <span>Short/Over <span className="text-sw-dim text-[10px]">(Cash − Safe Drop − House Account)</span></span>
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

            {/* Short/Over breakdown — Basket diff is displayed separately, NOT in the total. */}
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
                        <div className="flex justify-between">
                          <span className="text-sw-sub">R2 Short/Over <span className="text-sw-dim text-[10px]">(Net − Safe Drop)</span></span>
                          {fmtSO(r2ShortOverCalc)}
                        </div>
                      )}
                      <div className="flex justify-between border-t border-sw-border pt-1.5 mt-1 text-[13px]">
                        <span className="text-sw-text font-bold uppercase tracking-wide">Total Short/Over {usesReg2 ? '(R1 + R2)' : ''}</span>
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

            {/* Basket vs R2 — displayed separately, NOT part of Total Short/Over. */}
            {usesReg2 && (
              <div className="bg-sw-card2 border border-sw-border rounded-lg p-3">
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5">Basket vs R2 Difference</div>
                <div className="flex justify-between items-center text-[12px]">
                  <span className="text-sw-sub">
                    R2 Net {fmt(r2Net)} − Canceled Basket {fmt(r1CancelBasket)}
                  </span>
                  {(() => {
                    if (Math.abs(basketR2Diff) < 0.01) return <span className="text-sw-green font-mono font-bold">{fmt(0)} ✅</span>;
                    if (basketR2Diff < 0) return <span className="text-sw-red font-mono font-bold">-{fmt(Math.abs(basketR2Diff))}</span>;
                    return <span className="text-sw-green font-mono font-bold">+{fmt(basketR2Diff)}</span>;
                  })()}
                </div>
                <p className="text-sw-dim text-[10px] mt-1 italic">Tracked separately — not included in Total Short/Over.</p>
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
                <div className="text-sw-sub">House Account</div>
                <div className="text-right font-mono">
                  {Number(todayEntry.r1_house_account_amount ?? todayEntry.credits ?? 0) > 0 ? (
                    <span className="text-sw-text">{todayEntry.r1_house_account_name || 'Unnamed'} · {fmt(todayEntry.r1_house_account_amount ?? todayEntry.credits)}</span>
                  ) : (
                    <span className="text-sw-dim">None · {fmt(0)}</span>
                  )}
                </div>
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
            {modalError && (
              <div className="mb-3 rounded-lg border border-sw-red/30 bg-sw-redD text-sw-red text-[12px] p-2.5">
                ⚠️ {modalError}
              </div>
            )}
            {renderTabbedForm(empUsesReg2, /*allowShortOver*/ false, (
              <Field label="Date"><input type="date" value={todayStr} readOnly disabled /></Field>
            ))}
            {isOnSummaryTab ? (
              <Button onClick={handleSave} disabled={saving} className="w-full !py-3 !text-sm !rounded-xl mt-4">
                {saving ? 'Saving…' : 'Submit Sales'}
              </Button>
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
  // Display name in the modal: when editing, prefer the row's store; otherwise
  // the sidebar-selected store, then the form-local picked store.
  const storeName = stores.find(s => s.id === (editItem?.store_id || effectiveStoreId || formStoreId))?.name;

  const ownerUsesReg2 = hasRegister2(storeName);

  const resetReceipts = () => {
    setShiftReportFile(null); setShiftReportPreview(null);
    setR2ReportFile(null); setR2ReportPreview(null);
  };

  const tryOpenAdd = () => {
    if (!hasStore) { setShowStorePicker(true); return; }
    setForm(blankForm());
    setActiveTab('r1');
    setFieldErrors({});
    setModalError('');
    resetReceipts();
    setModal('add');
  };

  const closeModal = () => {
    setModal(null);
    setEditItem(null);
    setFieldErrors({});
    setModalError('');
    setFormStoreId(null);
    resetReceipts();
  };

  return (
    <div>
      <PageHeader title="Daily Sales" subtitle={`${hasStore ? storeName : 'All Stores'} · ${sales.length} entries`}>
        <Button variant="secondary" onClick={handleExport} className="!text-[11px]">📥 CSV</Button>
        {isOwner && <Button onClick={tryOpenAdd}>+ Add</Button>}
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}
      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable
          defaultSort={{ key: 'date', dir: 'desc' }}
          columns={[
          {
            key: '_status', label: '', align: 'center', render: (_, r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              const rowUsesR2 = hasRegister2(rowStore?.name);
              if (!rowUsesR2) return <span className="text-sw-green text-base" title="No Register 2">✅</span>;
              const diff = r.basket_r2_diff != null
                ? Number(r.basket_r2_diff)
                : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
              if (Math.abs(diff) < 0.01) {
                return <span className="text-sw-green text-base" title="Basket matches R2 Net">✅</span>;
              }
              return (
                <span
                  title={`R2 Net (${fmt(Number(r.r2_net || 0))}) − Canceled Basket (${fmt(Number(r.r1_canceled_basket || 0))}) = ${fmt(diff)}`}
                  className="text-sw-amber text-base"
                >
                  ⚠️
                </span>
              );
            },
          },
          { key: 'date', label: 'Date', render: v => dayLabel(v) },
          { key: 'store_id', label: 'Store', sortValue: (r) => r.stores?.name || '', render: (v, r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
          { key: 'gross_sales', label: 'Gross', align: 'right', mono: true, sortValue: (r) => Number(r.gross_sales ?? r.total_sales ?? 0), render: (v, r) => fmt(v ?? r.total_sales) },
          { key: 'net_sales', label: 'Net', align: 'right', mono: true, sortValue: (r) => Number(r.net_sales ?? ((r.gross_sales ?? r.total_sales) - (r.credits || 0))), render: (v, r) => <span className="text-sw-green font-bold">{fmt(v ?? ((r.gross_sales ?? r.total_sales) - (r.credits || 0)))}</span> },
          { key: 'cash_total', label: 'Cash', align: 'right', mono: true, sortable: true, sortValue: (r) => (Number(r.cash_sales || 0) + Number(r.register2_cash || 0)), render: (_, r) => fmt((r.cash_sales || 0) + (r.register2_cash || 0)) },
          { key: 'card_sales', label: 'Card', align: 'right', mono: true, sortValue: (r) => Number(r.card_sales || 0), render: v => fmt(v) },
          { key: 'cashapp_check', label: 'CApp/Chk', align: 'right', mono: true, sortValue: (r) => Number(r.cashapp_check || 0), render: v => fmt(v) },
          { key: 'credits', label: 'H/A', align: 'right', mono: true,
            sortValue: (r) => Number(r.r1_house_account_amount ?? r.credits ?? 0),
            render: (_, r) => {
              const amt = Number(r.r1_house_account_amount ?? r.credits ?? 0);
              if (amt === 0) return <span className="text-sw-dim">{fmt(0)}</span>;
              const nm = r.r1_house_account_name;
              return (
                <span className="text-sw-text">
                  {fmt(amt)}{nm ? <span className="text-sw-sub text-[10px]"> ({nm})</span> : null}
                </span>
              );
            } },
          { key: 'short_over', label: 'S/O', align: 'right', mono: true,
            sortValue: (r) => Number(r.short_over ?? 0),
            render: v => {
              // Only missing when truly null/undefined — zero is a valid "matched" state.
              if (v == null) return <span className="text-sw-dim">—</span>;
              const n = Number(v);
              if (Math.abs(n) < 0.01) return <span className="text-sw-green">{fmt(0)}</span>;
              // Positive = short (employee owes money) → red. Negative = over → green.
              if (n > 0) return <span className="text-sw-red font-bold">-{fmt(n)}</span>;
              return <span className="text-sw-green font-bold">+{fmt(Math.abs(n))}</span>;
            } },
          { key: '_basket_diff', label: 'Diff', align: 'right', mono: true, sortable: true,
            sortValue: (r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              if (!hasRegister2(rowStore?.name)) return null;
              return r.basket_r2_diff != null
                ? Number(r.basket_r2_diff)
                : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
            },
            render: (_, r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              const rowUsesR2 = hasRegister2(rowStore?.name);
              if (!rowUsesR2) return <span className="text-sw-dim">—</span>;
              const diff = r.basket_r2_diff != null
                ? Number(r.basket_r2_diff)
                : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
              if (Math.abs(diff) < 0.01) return <span className="text-sw-green">{fmt(0)}</span>;
              if (diff < 0) return <span className="text-sw-red">-{fmt(Math.abs(diff))}</span>;
              return <span className="text-sw-amber">+{fmt(diff)}</span>;
            } },
          { key: '_receipt', label: '📷', align: 'center', sortable: false, render: (_, r) => {
            const hasReceipts = !!(r.shift_report_url || r.safe_drop_url);
            if (!hasReceipts) return <span className="text-sw-dim">—</span>;
            return (
              <button
                onClick={() => setViewReceipts({
                  r1Url: r.shift_report_url || null,
                  r2Url: r.safe_drop_url || null,
                  storeName: r.stores?.name || '',
                  date: r.date,
                })}
                title="View receipts"
                className="text-sw-blue text-lg"
              >
                📷
              </button>
            );
          } },
          { key: 'entered_by', label: 'By',
            sortValue: (r) => r.profiles?.name || r.profiles?.username || '',
            render: (v, r) => <span className="text-sw-sub text-[11px]">{r.profiles?.name || r.profiles?.username || 'Unknown'}</span> },
          ...(isOwner ? [{
            key: '_actions', label: '', align: 'right', sortable: false, render: (_, r) => (
              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                <button
                  onClick={() => openEditRow(r)}
                  className="inline-flex items-center justify-center px-3 rounded-md bg-sw-blueD border border-sw-blue/30 text-sw-blue text-[12px] font-semibold"
                  style={{ minHeight: 32 }}
                >
                  Edit
                </button>
                <button
                  onClick={() => setConfirmDelete(r)}
                  className="inline-flex items-center justify-center px-3 rounded-md bg-sw-redD border border-sw-red/30 text-sw-red text-[12px] font-semibold"
                  style={{ minHeight: 32 }}
                >
                  Delete
                </button>
              </div>
            ),
          }] : []),
        ]} rows={sales} isOwner={false} />
      </div>

      {modal && (
        <Modal title={modal === 'edit' ? 'Edit Sale' : 'Add Sale'} onClose={closeModal}>
          {modalError && (
            <div className="mb-3 rounded-lg border border-sw-red/30 bg-sw-redD text-sw-red text-[12px] p-2.5">
              ⚠️ {modalError}
            </div>
          )}
          <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
            Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
          </div>
          {renderTabbedForm(ownerUsesReg2, /*allowShortOver*/ true, (
            <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          ))}
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : (modal === 'edit' ? 'Update' : 'Save')}
            </Button>
          </div>
        </Modal>
      )}

      {viewReceipts && (
        <Modal title={`Receipts · ${viewReceipts.storeName} · ${shortDate(viewReceipts.date)}`} onClose={() => setViewReceipts(null)} wide>
          <div className="space-y-4">
            {viewReceipts.r1Url && (
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1">Register 1 Shift Report</div>
                <img src={viewReceipts.r1Url} alt="R1 receipt" className="w-full max-h-[60vh] object-contain rounded-lg border border-sw-border bg-black/30" />
                <div className="flex gap-3 mt-1.5">
                  <a href={viewReceipts.r1Url} target="_blank" rel="noreferrer" className="text-sw-blue text-[11px] underline">Open</a>
                  <a href={viewReceipts.r1Url} download className="text-sw-blue text-[11px] underline">Download</a>
                </div>
              </div>
            )}
            {viewReceipts.r2Url && (
              <div>
                <div className="text-sw-sub text-[10px] font-bold uppercase mb-1">Register 2 Report</div>
                <img src={viewReceipts.r2Url} alt="R2 receipt" className="w-full max-h-[60vh] object-contain rounded-lg border border-sw-border bg-black/30" />
                <div className="flex gap-3 mt-1.5">
                  <a href={viewReceipts.r2Url} target="_blank" rel="noreferrer" className="text-sw-blue text-[11px] underline">Open</a>
                  <a href={viewReceipts.r2Url} download className="text-sw-blue text-[11px] underline">Download</a>
                </div>
              </div>
            )}
            {!viewReceipts.r1Url && !viewReceipts.r2Url && (
              <div className="text-sw-dim text-center py-6">No receipts uploaded for this entry.</div>
            )}
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="secondary" onClick={() => setViewReceipts(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {showStorePicker && (
        <StoreRequiredModal
          stores={stores}
          onCancel={() => setShowStorePicker(false)}
          onSelectStore={(s) => {
            // Only set the form-local store — never mutate the sidebar.
            setFormStoreId(s.id);
            setShowStorePicker(false);
            setForm(blankForm());
            setActiveTab('r1');
            setFieldErrors({});
            setModalError('');
            resetReceipts();
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
