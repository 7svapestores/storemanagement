'use client';
import { useState } from 'react';
import { Modal, Field, Button, SmartDatePicker } from '@/components/UI';
import { fmt, today } from '@/lib/utils';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function NRSSyncModal({ stores, onClose, onSuccess }) {
  const nrsStores = stores.filter(s => s.nrs_store_id);
  const [storeId, setStoreId] = useState(nrsStores[0]?.id || '');
  const [date, setDate] = useState(yesterday());
  const [preview, setPreview] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const doFetch = async () => {
    setFetching(true);
    setError('');
    setPreview(null);
    setExistingId(null);
    try {
      const res = await fetch('/api/nrs/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fetch failed');
      setPreview(data.preview);
      setExistingId(data.existing_sale_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/nrs/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, date, force_overwrite: overwrite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSuccess(true);
      setTimeout(() => { onSuccess?.(); onClose(); }, 1200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const storeName = nrsStores.find(s => s.id === storeId)?.name || '';

  return (
    <Modal title="Sync Daily Sales from NRS" onClose={onClose} wide>
      {success && (
        <div className="bg-sw-greenD text-sw-green border border-sw-green/30 rounded-lg p-3 mb-3 text-[13px] font-semibold text-center">
          Synced successfully!
        </div>
      )}
      {error && (
        <div className="bg-sw-redD text-sw-red border border-sw-red/30 rounded-lg p-3 mb-3 text-[12px]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Field label="Store">
          <select value={storeId} onChange={e => { setStoreId(e.target.value); setPreview(null); }}>
            {nrsStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <SmartDatePicker value={date} onChange={v => { setDate(v); setPreview(null); }} />
        </Field>
      </div>

      <Button onClick={doFetch} disabled={fetching || !storeId || !date} className="w-full mb-4">
        {fetching ? 'Fetching from NRS…' : 'Fetch from NRS'}
      </Button>

      {preview && (
        <div className="bg-sw-card2 border border-sw-border rounded-lg p-4 mb-4">
          <div className="text-sw-text text-[13px] font-bold mb-3">
            Preview — {storeName} — {date}
          </div>
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-[12px]">
            <div className="text-sw-sub">Gross Sales</div>
            <div className="text-right font-mono text-sw-text font-bold">{fmt(preview.r1_gross)}</div>
            <div className="text-sw-sub">Net Sales</div>
            <div className="text-right font-mono text-sw-green font-bold">{fmt(preview.r1_net)}</div>
            <div className="text-sw-sub">Cash</div>
            <div className="text-right font-mono">{fmt(preview.cash_sales)}</div>
            <div className="text-sw-sub">Card</div>
            <div className="text-right font-mono">{fmt(preview.card_sales)}</div>
            <div className="text-sw-sub">Sales Tax</div>
            <div className="text-right font-mono text-sw-cyan">{fmt(preview.tax_collected)}</div>
            <div className="text-sw-sub">Safe Drop</div>
            <div className="text-right font-mono">{fmt(preview.r1_safe_drop)}</div>
            <div className="text-sw-sub">Canceled Basket</div>
            <div className="text-right font-mono">{fmt(preview.r1_canceled_basket)}</div>
          </div>

          {existingId && (
            <div className="mt-3 bg-sw-amberD border border-sw-amber/30 rounded-lg p-2.5 text-[11px] text-sw-amber">
              <div className="font-bold mb-1">An entry already exists for this date.</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={e => setOverwrite(e.target.checked)}
                  className="!w-4 !h-4 !min-h-0 !p-0"
                />
                <span>I understand, overwrite existing data</span>
              </label>
            </div>
          )}

          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={doSync} disabled={syncing || (existingId && !overwrite)}>
              {syncing ? 'Saving…' : 'Save to Daily Sales'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
