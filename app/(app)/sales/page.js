'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Alert, Loading, StoreBadge, ConfirmModal, SmartDatePicker, SortDropdown, MultiSelect } from '@/components/UI';
import { Card, V2StatCard, Badge } from '@/components/ui';
import { fmt, fK, dayLabel, today, downloadCSV } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';
import { uploadReceipt, compressImage } from '@/lib/storage';
import NRSSyncModal from '@/components/NRSSyncModal';

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
  const [formError, setFormError] = useState('');
  const [nrsSyncOpen, setNrsSyncOpen] = useState(false);
  const [sortState, setSortState] = useState({ key: 'date', dir: 'desc' });
  const salesSortOptions = [
    { label: 'Date (newest)', key: 'date', dir: 'desc' },
    { label: 'Date (oldest)', key: 'date', dir: 'asc' },
    { label: 'Store A-Z', key: 'store_id', dir: 'asc' },
    { label: 'Gross (high-low)', key: 'gross_sales', dir: 'desc' },
    { label: 'Total (high-low)', key: 'total_sales', dir: 'desc' },
    { label: 'Cash (high-low)', key: 'cash_total', dir: 'desc' },
    { label: 'Status (alerts first)', key: '_status', dir: 'asc' },
  ];

  // Page-level filters
  const [pageStoreIds, setPageStoreIds] = useState(effectiveStoreId ? [effectiveStoreId] : []);
  const [employeeFilter, setEmployeeFilter] = useState([]);
  const [mismatchFilter, setMismatchFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (effectiveStoreId) setPageStoreIds([effectiveStoreId]);
  }, [effectiveStoreId]);
  // Local form-only store id. Used when the owner picks a store for a
  // specific Add entry while "All Stores" is selected in the sidebar.
  // This is NEVER written back to the sidebar's selectedStore.
  const [formStoreId, setFormStoreId] = useState(null);
  const [modalError, setModalError] = useState('');              // banner text shown inside the modal/form
  const [fieldErrors, setFieldErrors] = useState({});           // { fieldName: true }
  // Receipt upload state — arrays of images per register.
  // Each entry: { url: string, file?: File, existing?: boolean }
  //   existing === true  → already stored in DB (came from editItem)
  //   file present       → new upload pending at save time
  //   url is the preview URL (data: for new files, public URL for existing)
  const [r1Images, setR1Images] = useState([]);
  const [r2Images, setR2Images] = useState([]);
  const [saving, setSaving] = useState(false);
  const r1CameraRef = useRef(null);
  const r1LibraryRef = useRef(null);
  const r2CameraRef = useRef(null);
  const r2LibraryRef = useRef(null);
  // Receipt gallery modal (click 📷 in the owner table).
  const [viewReceipts, setViewReceipts] = useState(null); // { images: [urls], idx, storeName, date }
  const [viewReceipt, setViewReceipt] = useState(null); // { url, caption } for full-screen viewer
  const [activeTab, setActiveTab] = useState('r1'); // 'r1' | 'r2' | 'summary'
  const [form, setForm] = useState({
    date: today(),
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    cashapp_check: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    r2_net: '',
    register2_cash: '',
    r2_safe_drop: '',
    notes: '',
  });
  const [houseAccounts, setHouseAccounts] = useState([]);

  const blankForm = () => ({
    date: today(),
    r1_gross: '', r1_net: '',
    cash_sales: '', card_sales: '',
    cashapp_check: '',
    r1_canceled_basket: '', r1_safe_drop: '', r1_sales_tax: '',
    r2_net: '',
    register2_cash: '',
    r2_safe_drop: '',
    notes: '',
  });

  const resolveHAName = (entry) => {
    if (entry.choice === 'billy') return 'Billy';
    if (entry.choice === 'elias') return 'Elias';
    if (entry.choice === 'other') return (entry.customName || '').trim() || null;
    return null;
  };
  const haTotal = houseAccounts.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const addHA = () => setHouseAccounts(prev => [...prev, { choice: '', customName: '', amount: '' }]);
  const updateHA = (i, patch) => setHouseAccounts(prev => prev.map((e, j) => j === i ? { ...e, ...patch } : e));
  const removeHA = (i) => setHouseAccounts(prev => prev.filter((_, j) => j !== i));

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
      if (isEmployee && storeId) q = q.eq('store_id', storeId);
      else if (pageStoreIds.length) q = q.in('store_id', pageStoreIds);

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
  }, [range.start, range.end, storeId, pageStoreIds.join(',')]);

  useEffect(() => { load(); }, [load]);

  // Append picked files to the register's image list. Reads each file as a
  // data URL so the preview shows immediately; actual storage upload happens
  // on save.
  const appendPickedFiles = async (e, setter) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Reset the input so the same file can be picked again if removed.
    e.target.value = '';
    const reads = await Promise.all(files.map(f => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve({ url: ev.target.result, file: f });
      reader.readAsDataURL(f);
    })));
    setter(prev => [...prev, ...reads]);
  };
  const handleR1Pick = (e) => appendPickedFiles(e, setR1Images);
  const handleR2Pick = (e) => appendPickedFiles(e, setR2Images);

  const removeImage = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx));

  // Live duplicate check: whenever date or store changes in the modal, re-check
  // whether a sale already exists for that combination and show/clear the error.
  const modalStoreIdForDupe = editItem?.store_id || effectiveStoreId || formStoreId;
  useEffect(() => {
    if (!modal || modal === 'edit') return;
    if (!modalStoreIdForDupe || !form.date) { setModalError(''); return; }
    let cancelled = false;
    (async () => {
      const { data: existing } = await supabase
        .from('daily_sales')
        .select('id')
        .eq('store_id', modalStoreIdForDupe)
        .eq('date', form.date)
        .maybeSingle();
      if (cancelled) return;
      if (existing) {
        const name = stores.find(s => s.id === modalStoreIdForDupe)?.name || 'this store';
        setModalError(`Sales already entered for ${name} on ${shortDate(form.date)}. ${isOwner ? 'Use Edit on the existing row to change it.' : 'Contact the owner to make changes.'}`);
      } else {
        setModalError('');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, modalStoreIdForDupe, form.date]);

  const handleSave = async () => {
    const num = (v) => parseFloat(v) || 0;
    // When editing, the target is always the row's own store so an owner
    // can edit any row regardless of current sidebar selection. For new
    // entries, the sidebar or a form-local picked store is used.
    const storeIdToUse = isEmployee
      ? profile.store_id
      : (editItem?.store_id || effectiveStoreId || formStoreId);
    if (!storeIdToUse) {
      setFormError('Please select a store');
      return;
    }
    const storeForRegister = stores.find(s => s.id === storeIdToUse);
    const usesReg2 = !!storeForRegister?.has_register2;

    // ── Validation ─────────────────────────────────────────────
    const errs = {};
    const r1Required = ['r1_gross', 'r1_net', 'cash_sales', 'card_sales', 'r1_canceled_basket', 'r1_safe_drop', 'r1_sales_tax'];
    r1Required.forEach(k => { if (form[k] === '') errs[k] = true; });

    if (usesReg2) {
      if (form.r2_net === '')          errs.r2_net = true;
      if (form.register2_cash === '')  errs.register2_cash = true;
      if (form.r2_safe_drop === '')    errs.r2_safe_drop = true;
    }

    houseAccounts.forEach((e, i) => {
      if ((parseFloat(e.amount) || 0) > 0 && !resolveHAName(e)) {
        errs[`ha_name_${i}`] = true;
      }
    });

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

    // ── At least one receipt required for employees per register ──
    if (isEmployee && r1Images.length === 0) {
      setModalError('Please upload at least one Register 1 receipt before submitting.');
      setActiveTab('r1');
      return;
    }

    if (isEmployee && usesReg2 && r2Images.length === 0) {
      setModalError('Please upload at least one Register 2 receipt before submitting.');
      setActiveTab('r2');
      return;
    }

    // ── Upload any NEW images (pending files); existing URLs pass through ──
    const storeForPath = stores.find(s => s.id === storeIdToUse);
    setSaving(true);
    let r1Urls = [];
    let r2Urls = [];
    try {
      const uploadList = async (images, kind) => {
        const out = [];
        for (const img of images) {
          if (img.file) {
            const compressed = await compressImage(img.file);
            const up = await uploadReceipt(supabase, compressed, {
              storeName: storeForPath?.name,
              date: form.date || today(),
              kind, // 'r1' or 'r2'
            });
            out.push(up.url);
          } else if (img.url) {
            // Already-stored URL — just pass through.
            out.push(img.url);
          }
        }
        return out;
      };
      r1Urls = await uploadList(r1Images, 'r1');
      r2Urls = await uploadList(r2Images, 'r2');
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
      house_accounts: houseAccounts
        .filter(e => (parseFloat(e.amount) || 0) > 0)
        .map(e => ({ name: resolveHAName(e) || 'Unnamed', amount: parseFloat(e.amount) || 0 })),
      r1_house_account_name: houseAccounts.length ? (resolveHAName(houseAccounts[0]) || null) : null,
      r1_house_account_amount: haTotal,
      credits: haTotal,
      // Register 2 (zeros for single-register stores)
      r2_net: usesReg2 ? num(form.r2_net) : 0,
      r2_gross: usesReg2 ? num(form.r2_net) : 0, // legacy column kept in sync
      register2_cash: usesReg2 ? num(form.register2_cash) : 0,
      r2_safe_drop: usesReg2 ? num(form.r2_safe_drop) : 0,
      register2_card: 0,
      register2_credits: 0,
      // Multi-image arrays
      r1_receipt_urls: r1Urls,
      r2_receipt_urls: r2Urls,
      // Legacy single-URL columns kept in sync with the first image so old
      // code that reads them still works.
      shift_report_url: r1Urls[0] || null,
      safe_drop_url: r2Urls[0] || null,
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

    // Sync cash_collections: upsert a row with expected = safe drops.
    // Preserves any existing collected amount; only updates expected.
    const syncCashCollection = async () => {
      const expected = (data.r1_safe_drop || 0) + (data.r2_safe_drop || 0);
      const { error: ccErr } = await supabase
        .from('cash_collections')
        .upsert({
          store_id: data.store_id,
          date: data.date,
          expected_amount: expected,
        }, { onConflict: 'store_id,date', ignoreDuplicates: false });
      if (ccErr) console.warn('[sales] cash_collection sync failed (non-fatal):', ccErr);
    };

    if (modal === 'edit' && editItem) {
      const { error } = await supabase.from('daily_sales').update(data).eq('id', editItem.id);
      if (error) { setMsg(error.message); return; }
      await upsertShortOver(editItem.id);
      await syncCashCollection();
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
          setSaving(false);
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
        setSaving(false);
        return;
      }
      if (inserted?.id) await upsertShortOver(inserted.id);
      await syncCashCollection();
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
    setHouseAccounts([]);
    setActiveTab('r1');
    setFieldErrors({});
    setModalError('');
    setFormStoreId(null);
    setR1Images([]); setR2Images([]);
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
    // Delete linked cash collection first (keyed on store_id + date)
    const { error: ccErr } = await supabase
      .from('cash_collections')
      .delete()
      .eq('store_id', row.store_id)
      .eq('date', row.date);
    if (ccErr) console.warn('[sales] cash_collection cleanup failed (non-fatal):', ccErr);
    // Delete linked employee short/over
    await supabase.from('employee_shortover').delete().eq('sales_id', row.id);
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
      r2_net: r.r2_net ?? '',
      register2_cash: r.register2_cash ?? '',
      r2_safe_drop: r.r2_safe_drop ?? '',
      notes: r.notes || '',
    });
    // Populate house accounts from JSON array or legacy single fields
    if (Array.isArray(r.house_accounts) && r.house_accounts.length) {
      setHouseAccounts(r.house_accounts.map(e => {
        const nm = (e.name || '').trim();
        let choice = '';
        let customName = '';
        if (nm.toLowerCase() === 'billy') choice = 'billy';
        else if (nm.toLowerCase() === 'elias') choice = 'elias';
        else if (nm) { choice = 'other'; customName = nm; }
        return { choice, customName, amount: String(e.amount ?? '') };
      }));
    } else if ((r.r1_house_account_amount ?? r.credits ?? 0) > 0) {
      const nm = (r.r1_house_account_name || '').trim();
      let choice = '';
      let customName = '';
      if (nm.toLowerCase() === 'billy') choice = 'billy';
      else if (nm.toLowerCase() === 'elias') choice = 'elias';
      else if (nm) { choice = 'other'; customName = nm; }
      setHouseAccounts([{ choice, customName, amount: String(r.r1_house_account_amount ?? r.credits ?? '') }]);
    } else {
      setHouseAccounts([]);
    }
    setEditItem(r);
    setActiveTab('r1');
    setFieldErrors({});
    setModalError('');

    // Populate image arrays from the row. Prefer the new jsonb arrays,
    // fall back to legacy single-URL columns if arrays are missing.
    const r1 = Array.isArray(r.r1_receipt_urls) && r.r1_receipt_urls.length
      ? r.r1_receipt_urls
      : (r.shift_report_url ? [r.shift_report_url] : []);
    const r2 = Array.isArray(r.r2_receipt_urls) && r.r2_receipt_urls.length
      ? r.r2_receipt_urls
      : (r.safe_drop_url ? [r.safe_drop_url] : []);
    setR1Images(r1.map(url => ({ url, existing: true })));
    setR2Images(r2.map(url => ({ url, existing: true })));

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
  const r1HouseAmount  = haTotal;
  const r1Credits      = haTotal;

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
  const currentUsesReg2 = !!currentStoreObj?.has_register2;

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
              <Field label="CashApp / Check">
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.cashapp_check} onChange={onNum('cashapp_check')} />
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

            {/* House Account — multi-entry */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-sw-sub text-[10px] font-bold uppercase">House Account</div>
                {haTotal > 0 && <div className="text-sw-text text-[11px] font-mono font-bold">Total: {fmt(haTotal)}</div>}
              </div>
              {houseAccounts.length === 0 && (
                <p className="text-sw-dim text-[11px] italic mb-2">No house accounts — add below if needed</p>
              )}
              <div className="space-y-2 mb-2">
                {houseAccounts.map((entry, i) => (
                  <div key={i} className="flex gap-1.5 items-start flex-wrap sm:flex-nowrap">
                    <div className="flex-1 min-w-[120px]">
                      <select
                        value={entry.choice}
                        onChange={e => updateHA(i, { choice: e.target.value, customName: e.target.value === 'other' ? entry.customName : '' })}
                        className={fieldErrors[`ha_name_${i}`] ? '!border-sw-red' : ''}
                      >
                        <option value="">Select name…</option>
                        <option value="billy">Billy</option>
                        <option value="elias">Elias</option>
                        <option value="other">Other…</option>
                      </select>
                      {fieldErrors[`ha_name_${i}`] && <p className="text-sw-red text-[10px] mt-0.5">Name required</p>}
                    </div>
                    {entry.choice === 'other' && (
                      <div className="flex-1 min-w-[100px]">
                        <input
                          type="text"
                          placeholder="Name"
                          value={entry.customName}
                          onChange={e => updateHA(i, { customName: e.target.value })}
                        />
                      </div>
                    )}
                    <div className="w-[100px] flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={entry.amount}
                        onChange={e => updateHA(i, { amount: e.target.value.replace(/^-/, '') })}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeHA(i)}
                      className="w-8 h-[44px] rounded-md bg-sw-redD text-sw-red border border-sw-red/30 flex items-center justify-center flex-shrink-0"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addHA}
                className="text-sw-blue text-[11px] font-semibold border border-sw-blue/30 rounded px-2 py-1 bg-sw-blueD hover:bg-sw-blue/20"
              >
                + Add House Account
              </button>
            </div>

            {/* Live R1 short/over preview — Cash Sales − (Safe Drop + House Account). */}
            {(form.r1_safe_drop !== '' || form.cash_sales !== '') && (
              <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-2.5 flex justify-between items-center">
                <span className="text-sw-sub text-[11px] font-semibold uppercase">R1 Short/Over</span>
                {(() => {
                  const v = (parseFloat(form.cash_sales) || 0)
                          - ((parseFloat(form.r1_safe_drop) || 0) + haTotal);
                  if (Math.abs(v) < 0.01) return <span className="text-sw-dim font-mono font-bold">Matched {fmt(0)}</span>;
                  if (v > 0) return <span className="text-sw-red font-mono font-bold">Short -{fmt(v)}</span>;
                  return <span className="text-sw-green font-mono font-bold">Over +{fmt(Math.abs(v))}</span>;
                })()}
              </div>
            )}

            {/* R1 receipt upload — multiple images */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5 flex items-center gap-2">
                <span>📷 Register 1 Receipts</span>
                {r1Images.length > 0 && (
                  <span className="text-sw-dim text-[10px]">({r1Images.length})</span>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${isEmployee ? 'bg-sw-red/20 text-sw-red' : 'bg-sw-card text-sw-dim'}`}>
                  {isEmployee ? 'Required' : 'Optional'}
                </span>
              </div>

              {r1Images.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                  {r1Images.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <button
                        type="button"
                        onClick={() => setViewReceipts({ images: r1Images.map(i => i.url), idx, storeName: storeName || '', date: form.date })}
                        className="block w-full aspect-square rounded-lg overflow-hidden border border-sw-border bg-black/20"
                      >
                        <img src={img.url} alt={`R1 ${idx + 1}`} className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(setR1Images, idx)}
                        className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-sw-red text-white text-[11px] font-bold flex items-center justify-center shadow"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 flex-col sm:flex-row">
                <button
                  type="button"
                  onClick={() => r1CameraRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                >
                  <span className="text-lg">📷</span><span>Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => r1LibraryRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-lg border-2 border-dashed border-sw-blue/40 bg-sw-blueD text-sw-blue text-[12px] font-semibold min-h-[44px]"
                >
                  <span className="text-lg">📁</span><span>From Library</span>
                </button>
                <input ref={r1CameraRef} type="file" accept="image/*" capture="environment" multiple onChange={handleR1Pick} className="hidden" />
                <input ref={r1LibraryRef} type="file" accept="image/*" multiple onChange={handleR1Pick} className="hidden" />
              </div>
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

            {/* R2 receipt upload — multiple images */}
            <div className="mt-3 bg-sw-card2 border border-sw-border rounded-lg p-3">
              <div className="text-sw-sub text-[10px] font-bold uppercase mb-1.5 flex items-center gap-2">
                <span>📷 Register 2 Receipts</span>
                {r2Images.length > 0 && (
                  <span className="text-sw-dim text-[10px]">({r2Images.length})</span>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${isEmployee ? 'bg-sw-red/20 text-sw-red' : 'bg-sw-card text-sw-dim'}`}>
                  {isEmployee ? 'Required' : 'Optional'}
                </span>
              </div>

              {r2Images.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                  {r2Images.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <button
                        type="button"
                        onClick={() => setViewReceipts({ images: r2Images.map(i => i.url), idx, storeName: storeName || '', date: form.date })}
                        className="block w-full aspect-square rounded-lg overflow-hidden border border-sw-border bg-black/20"
                      >
                        <img src={img.url} alt={`R2 ${idx + 1}`} className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(setR2Images, idx)}
                        className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-sw-red text-white text-[11px] font-bold flex items-center justify-center shadow"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

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
                <input ref={r2CameraRef} type="file" accept="image/*" capture="environment" multiple onChange={handleR2Pick} className="hidden" />
                <input ref={r2LibraryRef} type="file" accept="image/*" multiple onChange={handleR2Pick} className="hidden" />
              </div>
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
                  {haTotal > 0
                    ? <span className="text-sw-text">{fmt(haTotal)} ({houseAccounts.filter(e => (parseFloat(e.amount)||0) > 0).length})</span>
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
    const empStoreObj = stores.find(s => s.id === profile?.store_id);
    const empUsesReg2 = !!empStoreObj?.has_register2;

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
                  {(() => {
                    const entries = Array.isArray(todayEntry.house_accounts) ? todayEntry.house_accounts : [];
                    const amt = entries.length ? entries.reduce((s,e) => s + (e.amount||0), 0) : Number(todayEntry.r1_house_account_amount ?? todayEntry.credits ?? 0);
                    if (amt <= 0) return <span className="text-sw-dim">None · {fmt(0)}</span>;
                    const label = entries.length > 1 ? `${entries.length} entries` : (entries[0]?.name || todayEntry.r1_house_account_name || 'Unnamed');
                    return <span className="text-sw-text">{label} · {fmt(amt)}</span>;
                  })()}
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
              <Button onClick={handleSave} disabled={saving || !!modalError} className="w-full !py-3 !text-sm !rounded-xl mt-4">
                {saving ? 'Saving…' : 'Submit Sales'}
              </Button>
            ) : (
              <Button onClick={() => setActiveTab(nextTabId)} className="w-full !py-3 !text-sm !rounded-xl mt-4">
                Next →
              </Button>
            )}
          </div>
        )}

        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-3 py-2 border-b border-sw-border"><h3 className="text-sw-text text-xs font-bold">Recent Entries (read-only)</h3></div>
          <DataTable columns={[
            { key: 'date', label: 'Date', render: v => dayLabel(v) },
            { key: 'gross_sales', label: 'Gross', align: 'right', mono: true, render: (v, r) => fmt(v ?? r.total_sales) },
            { key: 'total_sales', label: 'Total', align: 'right', mono: true, render: (v, r) => <span className="text-sw-green font-bold">{fmt(v ?? r.net_sales ?? 0)}</span> },
            { key: 'short_over', label: 'S/O', align: 'right', mono: true, render: v => {
              const n = Number(v || 0);
              if (Math.abs(n) < 0.01) return <span className="text-[var(--text-muted)]">{fmt(0)}</span>;
              return <span className={n < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'}>{n < 0 ? '−' : '+'}{fmt(Math.abs(n))}</span>;
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

  const modalStoreObj = stores.find(s => s.id === (editItem?.store_id || effectiveStoreId || formStoreId));
  const ownerUsesReg2 = !!modalStoreObj?.has_register2;

  const resetReceipts = () => {
    setR1Images([]);
    setR2Images([]);
  };

  // Unique employees from loaded data for the filter dropdown
  const employeeOptions = (() => {
    const map = {};
    let has7sAgent = false;
    sales.forEach(r => {
      if (r.sync_source === '7s_agent') { has7sAgent = true; return; }
      const p = r.profiles;
      if (p?.id) map[p.id] = p.name || p.username || 'Unknown';
    });
    const opts = Object.entries(map).map(([id, name]) => ({ value: id, label: name }));
    if (has7sAgent) opts.unshift({ value: '7s_agent', label: '🤖 7S Agent' });
    return opts;
  })();

  // Client-side filtering
  const filteredSales = sales.filter(r => {
    if (employeeFilter.length) {
      const isAgent = r.sync_source === '7s_agent';
      if (isAgent && !employeeFilter.includes('7s_agent')) return false;
      if (!isAgent && !employeeFilter.includes(r.entered_by)) return false;
    }
    if (mismatchFilter) {
      const st = stores.find(s => s.id === r.store_id);
      const usesR2 = !!st?.has_register2;
      if (usesR2) {
        const diff = r.basket_r2_diff != null ? Number(r.basket_r2_diff) : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
        const hasMismatch = Math.abs(diff) >= 0.01;
        if (mismatchFilter === 'mismatch' && !hasMismatch) return false;
        if (mismatchFilter === 'clean' && hasMismatch) return false;
      } else {
        if (mismatchFilter === 'mismatch') return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = [
        (r.stores?.name || '').toLowerCase(),
        String(r.gross_sales ?? r.total_sales ?? ''),
        String(r.net_sales ?? ''),
        (r.profiles?.name || r.profiles?.username || '').toLowerCase(),
        r.date || '',
      ].join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const tryOpenAdd = () => {
    setForm(blankForm());
    setHouseAccounts([]);
    setFormStoreId(effectiveStoreId || null);
    setFormError('');
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

  const totalNetSales = filteredSales.reduce((s, r) => s + (r.total_sales ?? r.net_sales ?? 0), 0);
  const agentCount = filteredSales.filter(r => r.sync_source === '7s_agent').length;
  const avgPerDay = (() => { const days = new Set(filteredSales.map(r => r.date)).size; return days > 0 ? totalNetSales / days : 0; })();

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-[var(--text-muted)] text-[11px] font-semibold uppercase tracking-wider">Sales</p>
          <h1 className="text-[var(--text-primary)] text-[22px] font-bold tracking-tight">Daily Sales</h1>
          <p className="text-[var(--text-secondary)] text-[12px]">{hasStore ? storeName : 'All Stores'} · {filteredSales.length} entries</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button variant="secondary" onClick={handleExport} className="!text-[11px]">📥 CSV</Button>
          {isOwner && <Button variant="secondary" onClick={() => setNrsSyncOpen(true)} className="!text-[11px]">🤖 Sync NRS</Button>}
          {isOwner && <Button onClick={tryOpenAdd}>+ Add</Button>}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <V2StatCard label="Total Sales" value={fK(totalNetSales)} variant="success" icon="💰" />
        <V2StatCard label="Entries" value={filteredSales.length} icon="📋" />
        <V2StatCard label="Avg / Day" value={fK(avgPerDay)} icon="📊" />
        <V2StatCard label="7S Agent" value={`${agentCount} of ${filteredSales.length}`} icon="🤖" sub={agentCount === filteredSales.length ? 'All auto-synced' : `${filteredSales.length - agentCount} manual`} />
      </div>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}
      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
        <MultiSelect
          label="Store"
          placeholder="All Stores"
          unitLabel="store"
          value={pageStoreIds}
          onChange={setPageStoreIds}
          options={stores.map(s => ({ value: s.id, label: s.name }))}
        />
        {employeeOptions.length > 0 && (
          <MultiSelect
            label="Employee"
            placeholder="All Employees"
            unitLabel="employee"
            value={employeeFilter}
            onChange={setEmployeeFilter}
            options={employeeOptions}
          />
        )}
        <div className="inline-flex items-center gap-2">
          <label className="text-sw-sub text-[10px] font-bold uppercase">Status</label>
          <select
            value={mismatchFilter}
            onChange={e => setMismatchFilter(e.target.value)}
            className="!w-auto !min-w-[160px] !py-1.5 !text-[11px]"
          >
            <option value="">All</option>
            <option value="mismatch">Mismatches only ⚠️</option>
            <option value="clean">Clean only ✅</option>
          </select>
        </div>
        <SortDropdown options={salesSortOptions} value={sortState} onChange={setSortState} />
        <input
          type="text"
          placeholder="Search… (store, amount, employee)"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="!w-full sm:!flex-1 sm:!min-w-[220px] !py-1.5 !text-[11px]"
        />
        {(pageStoreIds.length > 0 || employeeFilter.length > 0 || mismatchFilter || search) && (
          <button onClick={() => { setPageStoreIds([]); setEmployeeFilter([]); setMismatchFilter(''); setSearch(''); }} className="text-sw-dim text-[10px] underline">clear</button>
        )}
      </div>

      <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <DataTable
          sortState={sortState}
          onSortChange={setSortState}
          columns={[
          {
            key: '_status', label: '', align: 'center', sortable: true,
            sortValue: r => {
              const st = stores.find(s => s.id === r.store_id);
              if (!st?.has_register2) return 2;
              const diff = r.basket_r2_diff != null ? Number(r.basket_r2_diff) : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
              return Math.abs(diff) < 0.01 ? 2 : 1;
            },
            render: (_, r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              const rowUsesR2 = !!rowStore?.has_register2;
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
          { key: 'total_sales', label: 'Total', align: 'right', mono: true, sortValue: (r) => Number(r.total_sales ?? r.net_sales ?? 0), render: (v, r) => <span className="text-[var(--color-success)] font-bold">{fmt(v ?? r.net_sales ?? 0)}</span> },
          { key: 'cash_total', label: 'Cash', align: 'right', mono: true, sortable: true, sortValue: (r) => (Number(r.cash_sales || 0) + Number(r.register2_cash || 0)), render: (_, r) => fmt((r.cash_sales || 0) + (r.register2_cash || 0)) },
          { key: 'card_sales', label: 'Card', align: 'right', mono: true, sortValue: (r) => Number(r.card_sales || 0), render: v => fmt(v) },
          { key: 'cashapp_check', label: 'CApp/Chk', align: 'right', mono: true, sortValue: (r) => Number(r.cashapp_check || 0), render: v => fmt(v) },
          { key: 'credits', label: 'H/A', align: 'right', mono: true,
            sortValue: (r) => Number(r.r1_house_account_amount ?? r.credits ?? 0),
            render: (_, r) => {
              const amt = Number(r.r1_house_account_amount ?? r.credits ?? 0);
              if (amt === 0) return <span className="text-sw-dim">{fmt(0)}</span>;
              const entries = Array.isArray(r.house_accounts) ? r.house_accounts : [];
              const tooltip = entries.length > 0
                ? entries.map(e => `${e.name}: ${fmt(e.amount)}`).join(', ')
                : r.r1_house_account_name || '';
              return (
                <span className="text-sw-text" title={tooltip}>
                  {fmt(amt)}{entries.length > 1 ? <span className="text-sw-sub text-[10px]"> ({entries.length})</span> : (r.r1_house_account_name ? <span className="text-sw-sub text-[10px]"> ({r.r1_house_account_name})</span> : null)}
                </span>
              );
            } },
          { key: 'short_over', label: 'S/O', align: 'right', mono: true,
            sortValue: (r) => Number(r.short_over ?? 0),
            render: v => {
              if (v == null) return <span className="text-[var(--text-muted)]">—</span>;
              const n = Number(v);
              if (Math.abs(n) < 0.01) return <span className="text-[var(--text-muted)]">{fmt(0)}</span>;
              return <span className={`font-bold ${n < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'}`}>{n < 0 ? '−' : '+'}{fmt(Math.abs(n))}</span>;
            } },
          { key: '_basket_diff', label: 'Diff', align: 'right', mono: true, sortable: true,
            sortValue: (r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              if (!rowStore?.has_register2) return null;
              return r.basket_r2_diff != null
                ? Number(r.basket_r2_diff)
                : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
            },
            render: (_, r) => {
              const rowStore = stores.find(s => s.id === r.store_id);
              const rowUsesR2 = !!rowStore?.has_register2;
              if (!rowUsesR2) return <span className="text-sw-dim">—</span>;
              const diff = r.basket_r2_diff != null
                ? Number(r.basket_r2_diff)
                : (Number(r.r2_net || 0) - Number(r.r1_canceled_basket || 0));
              if (Math.abs(diff) < 0.01) return <span className="text-sw-green">{fmt(0)}</span>;
              if (diff < 0) return <span className="text-sw-red">-{fmt(Math.abs(diff))}</span>;
              return <span className="text-sw-amber">+{fmt(diff)}</span>;
            } },
          { key: '_receipt', label: '📷', align: 'center', sortable: false, render: (_, r) => {
            const r1 = Array.isArray(r.r1_receipt_urls) ? r.r1_receipt_urls : (r.shift_report_url ? [r.shift_report_url] : []);
            const r2 = Array.isArray(r.r2_receipt_urls) ? r.r2_receipt_urls : (r.safe_drop_url ? [r.safe_drop_url] : []);
            const all = [...r1, ...r2];
            if (all.length === 0) return <span className="text-sw-dim">—</span>;
            return (
              <button
                onClick={() => setViewReceipts({ images: all, idx: 0, storeName: r.stores?.name || '', date: r.date })}
                title={`View ${all.length} receipt${all.length > 1 ? 's' : ''}`}
                className="inline-flex items-center gap-0.5 text-sw-blue"
              >
                <span className="text-lg">📷</span>
                <span className="text-[10px] font-bold">{all.length}</span>
              </button>
            );
          } },
          { key: 'entered_by', label: 'By',
            sortValue: (r) => r.sync_source === '7s_agent' ? '0_agent' : (r.profiles?.name || r.profiles?.username || 'zzz'),
            render: (v, r) => {
              if (r.sync_source === '7s_agent') {
                const via = r.profiles?.name;
                return (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#C084FC' }}>
                    🤖 7S Agent{via ? <span className="font-normal text-sw-dim"> via {via}</span> : ''}
                  </span>
                );
              }
              return <span className="text-sw-sub text-[11px]">{r.profiles?.name || r.profiles?.username || 'Unknown'}</span>;
            } },
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
        ]} rows={filteredSales} isOwner={false} />
      </div>

      {modal && (
        <Modal title={modal === 'edit' ? 'Edit Sale' : 'Add Sale'} onClose={closeModal}>
          {modalError && (
            <div className="mb-3 rounded-lg border border-sw-red/30 bg-sw-redD text-sw-red text-[12px] p-2.5">
              ⚠️ {modalError}
            </div>
          )}
          <Field label="Store">
            <select
              value={editItem?.store_id || formStoreId || ''}
              onChange={e => {
                setFormStoreId(e.target.value);
                setFormError('');
                setActiveTab('r1');
              }}
              style={formError ? { borderColor: '#F87171' } : undefined}
              disabled={!!editItem}
            >
              <option value="">Select store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {formError && <div className="text-sw-red text-[11px] font-semibold mt-1">{formError}</div>}
          </Field>
          {renderTabbedForm(ownerUsesReg2, /*allowShortOver*/ true, (
            <Field label="Date"><SmartDatePicker value={form.date} onChange={v => setForm({ ...form, date: v })} /></Field>
          ))}
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || (modal !== 'edit' && !!modalError)}>
              {saving ? 'Saving…' : (modal === 'edit' ? 'Update' : 'Save')}
            </Button>
          </div>
        </Modal>
      )}

      {viewReceipts && viewReceipts.images.length > 0 && (() => {
        const imgs = viewReceipts.images;
        const i = Math.min(Math.max(viewReceipts.idx || 0, 0), imgs.length - 1);
        const url = imgs[i];
        const prev = () => setViewReceipts(v => ({ ...v, idx: (i - 1 + imgs.length) % imgs.length }));
        const next = () => setViewReceipts(v => ({ ...v, idx: (i + 1) % imgs.length }));
        return (
          <Modal title={`Receipts · ${viewReceipts.storeName} · ${shortDate(viewReceipts.date)}`} onClose={() => setViewReceipts(null)} wide>
            <div className="relative bg-black/30 rounded-lg border border-sw-border overflow-hidden">
              <img src={url} alt={`Receipt ${i + 1}`} className="w-full max-h-[60vh] object-contain" />
              {imgs.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white text-xl font-bold flex items-center justify-center"
                    title="Previous"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white text-xl font-bold flex items-center justify-center"
                    title="Next"
                  >
                    ›
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[11px] font-semibold rounded-full px-2 py-0.5">
                    {i + 1} / {imgs.length}
                  </div>
                </>
              )}
            </div>
            {imgs.length > 1 && (
              <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
                {imgs.map((u, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setViewReceipts(v => ({ ...v, idx }))}
                    className={`flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 ${idx === i ? 'border-sw-blue' : 'border-sw-border'}`}
                  >
                    <img src={u} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-3">
                <a href={url} target="_blank" rel="noreferrer" className="text-sw-blue text-[11px] underline">Open</a>
                <a href={url} download className="text-sw-blue text-[11px] underline">Download</a>
              </div>
              <Button variant="secondary" onClick={() => setViewReceipts(null)}>Close</Button>
            </div>
          </Modal>
        );
      })()}

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
      {nrsSyncOpen && (
        <NRSSyncModal
          stores={stores}
          onClose={() => setNrsSyncOpen(false)}
          onSuccess={load}
        />
      )}
    </div>
  );
}
