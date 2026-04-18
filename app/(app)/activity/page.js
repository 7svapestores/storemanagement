'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, DateBar, useDateRange, Loading, Alert, MultiSelect } from '@/components/UI';

const ENTITY_LABEL = {
  daily_sales: 'Daily Sale',
  cash_collection: 'Cash Collection',
  purchase: 'Purchase',
  expense: 'Expense',
  inventory: 'Inventory',
  vendor: 'Vendor',
  store: 'Store',
  user: 'User',
};

const ACTION_STYLE = {
  create: { bg: 'bg-sw-greenD', text: 'text-[var(--color-success)]', label: 'CREATE', icon: '➕' },
  update: { bg: 'bg-sw-blueD',  text: 'text-[var(--color-info)]',  label: 'UPDATE', icon: '✎'  },
  delete: { bg: 'bg-sw-redD',   text: 'text-[var(--color-danger)]',   label: 'DELETE', icon: '✕'  },
};

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return String(ts); }
}

export default function ActivityPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');
  const [rows, setRows] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionFilter, setActionFilter] = useState([]);
  const [entityFilter, setEntityFilter] = useState([]);
  const [storeFilter, setStoreFilter] = useState([]);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const { data: st } = await supabase.from('stores').select('id, name').order('name');
        setStores(st || []);

        let q = supabase
          .from('activity_log')
          .select('*')
          .gte('created_at', range.start)
          .lte('created_at', range.end + 'T23:59:59')
          .order('created_at', { ascending: false })
          .limit(500);
        if (actionFilter.length) q = q.in('action', actionFilter);
        if (entityFilter.length) q = q.in('entity_type', entityFilter);
        if (storeFilter.length) q = q.in('store_name', storeFilter);

        const { data, error } = await q;
        if (error) throw error;
        setRows(data || []);
      } catch (e) {
        console.error('[activity] load failed:', e);
        setLoadError(e?.message || 'Failed to load activity log');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range.start, range.end, actionFilter.join(','), entityFilter.join(','), storeFilter.join(',')]);

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  const counts = {
    create: rows.filter(r => r.action === 'create').length,
    update: rows.filter(r => r.action === 'update').length,
    delete: rows.filter(r => r.action === 'delete').length,
  };

  return (
    <div>
      <PageHeader
        title="🕐 Activity Log"
        subtitle={`${rows.length} events · ${counts.create} created · ${counts.update} updated · ${counts.delete} deleted`}
      />

      {loadError && <Alert type="error">{loadError}</Alert>}

      <DateBar
        preset={preset} onPreset={selectPreset}
        startDate={range.start} endDate={range.end}
        onStartChange={setStart} onEndChange={setEnd}
      />

      <div className="bg-[var(--bg-elevated)] rounded-lg p-2.5 border border-[var(--border-subtle)] mb-3 flex gap-2 flex-wrap items-center">
        <MultiSelect
          label="Action"
          placeholder="All Actions"
          value={actionFilter}
          onChange={setActionFilter}
          options={[
            { value: 'create', label: 'Create' },
            { value: 'update', label: 'Update' },
            { value: 'delete', label: 'Delete' },
          ]}
        />
        <MultiSelect
          label="Entity"
          placeholder="All Entities"
          value={entityFilter}
          onChange={setEntityFilter}
          options={Object.entries(ENTITY_LABEL).map(([k, v]) => ({ value: k, label: v }))}
        />
        <MultiSelect
          label="Store"
          placeholder="All Stores"
          value={storeFilter}
          onChange={setStoreFilter}
          options={stores.map(s => ({ value: s.name, label: s.name }))}
        />
      </div>

      {rows.length === 0 ? (
        <div className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-8 text-center text-[var(--text-muted)]">
          No activity recorded for this period.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const style = ACTION_STYLE[r.action] || ACTION_STYLE.update;
            const isOpen = expanded === r.id;
            const hasMeta = r.metadata && Object.keys(r.metadata).length > 0;
            return (
              <div key={r.id} className="bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] p-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${style.bg} ${style.text} text-base font-bold flex-shrink-0`}>
                    {style.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text} uppercase tracking-wide`}>
                        {style.label}
                      </span>
                      <span className="text-[var(--text-secondary)] text-[10px] font-semibold uppercase tracking-wide">
                        {ENTITY_LABEL[r.entity_type] || r.entity_type}
                      </span>
                      {r.store_name && (
                        <span className="text-[var(--text-muted)] text-[10px]">· {r.store_name}</span>
                      )}
                    </div>
                    <div className="text-[var(--text-primary)] text-[13px] font-medium break-words">
                      {r.description}
                    </div>
                    <div className="text-[var(--text-muted)] text-[11px] mt-1">
                      <span className="text-[var(--text-secondary)] font-semibold">{r.user_name}</span>
                      <span className="capitalize"> ({r.user_role})</span>
                      <span> · {fmtTime(r.created_at)}</span>
                    </div>
                    {hasMeta && (
                      <button
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="mt-2 text-[var(--color-info)] text-[11px] underline"
                      >
                        {isOpen ? 'Hide details' : 'Show deleted data'}
                      </button>
                    )}
                    {hasMeta && isOpen && (
                      <pre className="mt-2 text-[10px] bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-lg p-2 overflow-auto text-[var(--text-secondary)] max-h-60">
{JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
