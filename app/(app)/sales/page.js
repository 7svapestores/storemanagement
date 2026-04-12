'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Alert, Loading, StoreBadge, ConfirmModal } from '@/components/UI';
import { fmt, fK, dayLabel, today, downloadCSV } from '@/lib/utils';
import { logActivity, fmtMoney, shortDate } from '@/lib/activity';

export default function SalesPage() {
  const { supabase, isOwner, isEmployee, profile } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [sales, setSales] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [msg, setMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ store_id: '', date: today(), cash_sales: '', card_sales: '', credits: '', notes: '' });

  const storeId = isEmployee ? profile?.store_id : null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data: storeData } = await supabase.from('stores').select('*').order('created_at');
      setStores(storeData || []);

      let q = supabase.from('daily_sales').select('*, stores(name, color), profiles!daily_sales_entered_by_fkey(name)')
        .gte('date', range.start).lte('date', range.end).order('date', { ascending: false });
      if (storeId) q = q.eq('store_id', storeId);
      const { data } = await q;
      setSales(data || []);

      if (!form.store_id && storeData?.length) {
        setForm(f => ({ ...f, store_id: storeId || storeData[0].id }));
      }
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
    const data = {
      store_id: isEmployee ? profile.store_id : form.store_id,
      date: form.date,
      cash_sales: cs,
      card_sales: cd,
      credits: parseFloat(form.credits) || 0,
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
    setForm({ store_id: storeId || stores[0]?.id || '', date: today(), cash_sales: '', card_sales: '', credits: '', notes: '' });
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
      ['Date', 'Store', 'Cash Sales', 'Card Sales', 'Total', 'Credits', 'Tax'],
      sales.map(s => [s.date, sn(s.store_id), s.cash_sales, s.card_sales, s.total_sales, s.credits, s.tax_collected])
    );
  };

  const total = (parseFloat(form.cash_sales) || 0) + (parseFloat(form.card_sales) || 0);

  // ── Employee simplified view ────────────────────────────
  if (isEmployee) {
    const todayStr = today();
    const todayEntry = sales.find(s => s.date === todayStr && s.store_id === profile?.store_id);
    const storeName = stores.find(s => s.id === profile?.store_id)?.name;

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
            <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Cash Sales"><input type="number" placeholder="0.00" value={form.cash_sales} onChange={e => setForm({ ...form, cash_sales: e.target.value })} /></Field>
              <Field label="Card Sales"><input type="number" placeholder="0.00" value={form.card_sales} onChange={e => setForm({ ...form, card_sales: e.target.value })} /></Field>
            </div>
            <Field label="Credits"><input type="number" placeholder="0.00" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value })} /></Field>
            <Field label="Notes"><input placeholder="Optional" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>

            {total > 0 && (
              <div className="bg-sw-card2 rounded-lg p-3 mb-3 border border-sw-border flex justify-between">
                <span className="text-sw-text text-[13px] font-bold">Total</span>
                <span className="text-sw-green text-base font-extrabold font-mono">{fmt(total)}</span>
              </div>
            )}

            <Button onClick={handleSave} className="w-full !py-3 !text-sm !rounded-xl">Submit Sales</Button>
          </div>
        )}

        <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
          <div className="px-3 py-2 border-b border-sw-border"><h3 className="text-sw-text text-xs font-bold">Recent Entries (read-only)</h3></div>
          <DataTable columns={[
            { key: 'date', label: 'Date', render: v => dayLabel(v) },
            { key: 'cash_sales', label: 'Cash', align: 'right', mono: true, render: v => fmt(v) },
            { key: 'card_sales', label: 'Card', align: 'right', mono: true, render: v => fmt(v) },
            { key: 'total_sales', label: 'Total', align: 'right', mono: true, render: v => <span className="text-sw-green font-bold">{fmt(v)}</span> },
          ]} rows={sales.slice(0, 14)} isOwner={false} />
        </div>
        <div className="mt-3 p-2 bg-sw-card2 rounded-lg"><p className="text-sw-dim text-[10px]">🔒 Only the owner can edit/delete entries</p></div>
      </div>
    );
  }

  // ── Owner full view ─────────────────────────────────────
  if (loading) return <Loading />;

  return (
    <div>
      <PageHeader title="Daily Sales" subtitle={`${sales.length} entries`}>
        <Button variant="secondary" onClick={handleExport} className="!text-[11px]">📥 CSV</Button>
        <Button onClick={() => { setForm({ store_id: storeId || stores[0]?.id || '', date: today(), cash_sales: '', card_sales: '', credits: '', notes: '' }); setModal('add'); }}>+ Add</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}
      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />

      <div className="bg-sw-card rounded-xl border border-sw-border overflow-hidden">
        <DataTable columns={[
          { key: 'date', label: 'Date', render: v => dayLabel(v) },
          { key: 'store_id', label: 'Store', render: (v, r) => <StoreBadge name={r.stores?.name} color={r.stores?.color} /> },
          { key: 'cash_sales', label: 'Cash', align: 'right', mono: true, render: v => fmt(v) },
          { key: 'card_sales', label: 'Card', align: 'right', mono: true, render: v => fmt(v) },
          { key: 'total_sales', label: 'Total', align: 'right', mono: true, render: v => <span className="text-sw-green font-bold">{fmt(v)}</span> },
          { key: 'tax_collected', label: 'Tax', align: 'right', mono: true, render: v => <span className="text-sw-cyan">{fmt(v)}</span> },
          { key: 'credits', label: 'Credits', align: 'right', mono: true, render: v => fmt(v) },
          { key: 'entered_by', label: 'By', render: (v, r) => <span className="text-sw-sub text-[11px]">{r.profiles?.name || '—'}</span> },
        ]} rows={sales} isOwner={true}
          onEdit={r => { setForm({ store_id: r.store_id, date: r.date, cash_sales: r.cash_sales, card_sales: r.card_sales, credits: r.credits, notes: r.notes || '' }); setEditItem(r); setModal('edit'); }}
          onDelete={handleDelete} />
      </div>

      {modal && (
        <Modal title={modal === 'edit' ? 'Edit Sale' : 'Add Sale'} onClose={() => { setModal(null); setEditItem(null); }}>
          <Field label="Store">
            <select value={form.store_id} onChange={e => setForm({ ...form, store_id: e.target.value })}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Cash Sales"><input type="number" placeholder="0.00" value={form.cash_sales} onChange={e => setForm({ ...form, cash_sales: e.target.value })} /></Field>
            <Field label="Card Sales"><input type="number" placeholder="0.00" value={form.card_sales} onChange={e => setForm({ ...form, card_sales: e.target.value })} /></Field>
          </div>
          <Field label="Credits"><input type="number" placeholder="0.00" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value })} /></Field>
          <Field label="Notes"><input placeholder="Optional" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="secondary" onClick={() => { setModal(null); setEditItem(null); }}>Cancel</Button>
            <Button onClick={handleSave}>{modal === 'edit' ? 'Update' : 'Save'}</Button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete this sale?"
          message={`Are you sure? This will be logged in the activity trail. Deleting daily sale for ${confirmDelete.stores?.name || 'store'} on ${shortDate(confirmDelete.date)}.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={confirmDeleteSale}
        />
      )}
    </div>
  );
}
