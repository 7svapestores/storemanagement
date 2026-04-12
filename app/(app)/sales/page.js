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
  const [form, setForm] = useState({
    date: today(),
    cash_sales: '', card_sales: '',
    register2_cash: '', register2_card: '',
    credits: '', short_over: '', notes: '',
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
    const cs = parseFloat(form.cash_sales) || 0;
    const cd = parseFloat(form.card_sales) || 0;
    const storeIdToUse = isEmployee ? profile.store_id : effectiveStoreId;
    if (!storeIdToUse) {
      setMsg('Please select a store from the sidebar first.');
      return;
    }
    const storeForRegister = stores.find(s => s.id === storeIdToUse);
    const usesReg2 = hasRegister2(storeForRegister?.name);
    const r2Cash = usesReg2 ? (parseFloat(form.register2_cash) || 0) : 0;
    const r2Card = usesReg2 ? (parseFloat(form.register2_card) || 0) : 0;

    const data = {
      store_id: storeIdToUse,
      // Employees can only enter for today, regardless of what's in the form.
      date: isEmployee ? today() : form.date,
      cash_sales: cs,
      card_sales: cd,
      register2_cash: r2Cash,
      register2_card: r2Card,
      credits: parseFloat(form.credits) || 0,
      // Employees cannot set short/over — only owners.
      short_over: isOwner ? (parseFloat(form.short_over) || 0) : 0,
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
        description: `${profile?.name} updated daily sale of ${fmtMoney(total)} for ${storeName} on ${shortDate(data.date)}`,
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
        description: `${profile?.name} added daily sale of ${fmtMoney(total)} for ${storeName} on ${shortDate(data.date)}`,
        storeName,
      });
    }

    setModal(null); setEditItem(null);
    setMsg('success'); setTimeout(() => setMsg(''), 2500);
    setForm({ date: today(), cash_sales: '', card_sales: '', register2_cash: '', register2_card: '', credits: '', short_over: '', notes: '' });
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

  // Live-calculated totals for the form.
  const r1Cash = parseFloat(form.cash_sales) || 0;
  const r1Card = parseFloat(form.card_sales) || 0;
  const r2Cash = parseFloat(form.register2_cash) || 0;
  const r2Card = parseFloat(form.register2_card) || 0;
  const credits = parseFloat(form.credits) || 0;
  const gross = r1Cash + r1Card + r2Cash + r2Card;
  const net = gross - credits;
  const total = gross; // legacy name used below

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
            <Field label="Date"><input type="date" value={todayStr} readOnly disabled /></Field>

            <div className="text-sw-sub text-[10px] font-bold uppercase tracking-wider mt-2 mb-1">Register 1</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label="Cash Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.cash_sales} onChange={e => setForm({ ...form, cash_sales: e.target.value.replace(/^-/, '') })} /></Field>
              <Field label="Card Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.card_sales} onChange={e => setForm({ ...form, card_sales: e.target.value.replace(/^-/, '') })} /></Field>
            </div>

            {empUsesReg2 && (
              <>
                <div className="text-sw-sub text-[10px] font-bold uppercase tracking-wider mt-2 mb-1">Register 2</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="R2 Cash Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_cash} onChange={e => setForm({ ...form, register2_cash: e.target.value.replace(/^-/, '') })} /></Field>
                  <Field label="R2 Card Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_card} onChange={e => setForm({ ...form, register2_card: e.target.value.replace(/^-/, '') })} /></Field>
                </div>
              </>
            )}

            <Field label="Credits"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value.replace(/^-/, '') })} /></Field>
            <Field label="Notes"><input placeholder="Optional" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>

            {gross > 0 && (
              <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border space-y-1">
                <div className="flex justify-between"><span className="text-sw-sub text-[11px]">Gross Sales</span><span className="text-sw-text text-sm font-mono font-bold">{fmt(gross)}</span></div>
                <div className="flex justify-between"><span className="text-sw-sub text-[11px]">Credits</span><span className="text-sw-sub text-sm font-mono">- {fmt(credits)}</span></div>
                <div className="flex justify-between border-t border-sw-border pt-1"><span className="text-sw-text text-[12px] font-bold">Net Sales</span><span className="text-sw-green text-base font-extrabold font-mono">{fmt(net)}</span></div>
              </div>
            )}

            <Button onClick={handleSave} className="w-full !py-3 !text-sm !rounded-xl">Submit Sales</Button>
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
    setForm({ date: today(), cash_sales: '', card_sales: '', register2_cash: '', register2_card: '', credits: '', short_over: '', notes: '' });
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
            cash_sales: r.cash_sales, card_sales: r.card_sales,
            register2_cash: r.register2_cash || '', register2_card: r.register2_card || '',
            credits: r.credits, short_over: r.short_over || '',
            notes: r.notes || '',
          }); setEditItem(r); setModal('edit'); } : undefined}
          onDelete={hasStore ? handleDelete : undefined} />
      </div>

      {modal && (
        <Modal title={modal === 'edit' ? 'Edit Sale' : 'Add Sale'} onClose={() => { setModal(null); setEditItem(null); }}>
          <div className="bg-sw-card2 rounded-lg p-2 mb-3 border border-sw-border text-[11px]">
            Store: <span className="text-sw-text font-semibold">{storeName || '—'}</span>
          </div>
          <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>

          <div className="text-sw-sub text-[10px] font-bold uppercase tracking-wider mt-2 mb-1">Register 1</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Cash Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.cash_sales} onChange={e => setForm({ ...form, cash_sales: e.target.value.replace(/^-/, '') })} /></Field>
            <Field label="Card Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.card_sales} onChange={e => setForm({ ...form, card_sales: e.target.value.replace(/^-/, '') })} /></Field>
          </div>

          {ownerUsesReg2 && (
            <>
              <div className="text-sw-sub text-[10px] font-bold uppercase tracking-wider mt-2 mb-1">Register 2</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Field label="R2 Cash Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_cash} onChange={e => setForm({ ...form, register2_cash: e.target.value.replace(/^-/, '') })} /></Field>
                <Field label="R2 Card Sales"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.register2_card} onChange={e => setForm({ ...form, register2_card: e.target.value.replace(/^-/, '') })} /></Field>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
            <Field label="Credits"><input type="number" min="0" step="0.01" placeholder="0.00" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value.replace(/^-/, '') })} /></Field>
            <Field label="Short / Over"><input type="number" step="0.01" placeholder="0.00" value={form.short_over} onChange={e => setForm({ ...form, short_over: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><input placeholder="Optional" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>

          {gross > 0 && (
            <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border space-y-1">
              <div className="flex justify-between"><span className="text-sw-sub text-[11px]">Gross Sales</span><span className="text-sw-text text-sm font-mono font-bold">{fmt(gross)}</span></div>
              <div className="flex justify-between"><span className="text-sw-sub text-[11px]">Credits</span><span className="text-sw-sub text-sm font-mono">- {fmt(credits)}</span></div>
              <div className="flex justify-between border-t border-sw-border pt-1"><span className="text-sw-text text-[12px] font-bold">Net Sales</span><span className="text-sw-green text-base font-extrabold font-mono">{fmt(net)}</span></div>
            </div>
          )}

          <div className="flex gap-2 justify-end mt-2">
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
            setForm({ date: today(), cash_sales: '', card_sales: '', register2_cash: '', register2_card: '', credits: '', short_over: '', notes: '' });
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
