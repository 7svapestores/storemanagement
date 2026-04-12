'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { DataTable, DateBar, useDateRange, PageHeader, Modal, Field, Button, Alert, Loading, StoreBadge } from '@/components/UI';
import { fmt, fK, dayLabel, today, downloadCSV } from '@/lib/utils';

export default function SalesPage() {
  const { supabase, isOwner, isEmployee, profile } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [sales, setSales] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ store_id: '', date: today(), cash_sales: '', card_sales: '', credits: '', notes: '' });

  const storeId = isEmployee ? profile?.store_id : null;

  const load = useCallback(async () => {
    setLoading(true);
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
    setLoading(false);
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

    let error;
    if (modal === 'edit' && editItem) {
      ({ error } = await supabase.from('daily_sales').update(data).eq('id', editItem.id));
    } else {
      ({ error } = await supabase.from('daily_sales').insert(data));
    }

    if (error) { setMsg(error.message); return; }
    setModal(null); setEditItem(null);
    setMsg('success'); setTimeout(() => setMsg(''), 2500);
    setForm({ store_id: storeId || stores[0]?.id || '', date: today(), cash_sales: '', card_sales: '', credits: '', notes: '' });
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this sale?')) return;
    await supabase.from('daily_sales').delete().eq('id', id);
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
    return (
      <div className="max-w-xl mx-auto">
        <PageHeader title="Enter Daily Sales" subtitle={stores.find(s => s.id === profile?.store_id)?.name} />
        {msg === 'success' && <Alert type="success">Sales recorded!</Alert>}
        {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

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
    </div>
  );
}
