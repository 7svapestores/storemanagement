'use client';
import { useAuth } from '@/components/AuthProvider';
import { DateBar, useDateRange, PageHeader, Button } from '@/components/UI';
import { downloadCSV, fmt } from '@/lib/utils';

export default function ExportsPage() {
  const { supabase, isOwner } = useAuth();
  const { range, preset, selectPreset, setStart, setEnd } = useDateRange('last30');

  if (!isOwner) return <div className="text-sw-dim text-center py-20">Owner access required</div>;

  const exportData = async (type) => {
    if (type === 'sales') {
      const { data } = await supabase.from('daily_sales').select('*, stores(name)').gte('date', range.start).lte('date', range.end);
      downloadCSV('sales.csv', ['Date','Store','Cash','Card','Total','Credits','Tax'], data?.map(s => [s.date, s.stores?.name, s.cash_sales, s.card_sales, s.total_sales, s.credits, s.tax_collected])||[]);
    } else if (type === 'purchases') {
      const { data } = await supabase.from('purchases').select('*, stores(name)').gte('week_of', range.start).lte('week_of', range.end);
      downloadCSV('purchases.csv', ['Week','Store','Item','Category','Qty','Cost','Total','Vendor'], data?.map(p => [p.week_of, p.stores?.name, p.item, p.category, p.quantity, p.unit_cost, p.total_cost, p.supplier])||[]);
    } else if (type === 'expenses') {
      const { data } = await supabase.from('expenses').select('*, stores(name)');
      downloadCSV('expenses.csv', ['Month','Store','Category','Amount','Note'], data?.map(e => [e.month, e.stores?.name, e.category, e.amount, e.note])||[]);
    } else if (type === 'inventory') {
      const { data } = await supabase.from('inventory').select('*, stores(name), vendors(name)').eq('is_active', true);
      downloadCSV('inventory.csv', ['Store','Product','Category','Cost','Sell','Margin%','Stock','Reorder','Vendor'], data?.map(i => [i.stores?.name, i.name, i.category, i.cost_price, i.sell_price, ((i.sell_price-i.cost_price)/i.sell_price*100).toFixed(1), i.stock, i.reorder_level, i.vendors?.name])||[]);
    }
  };

  const cards = [
    { icon: '💰', title: 'Daily Sales', desc: 'Cash, card, total, tax per day', type: 'sales' },
    { icon: '🛒', title: 'Purchases', desc: 'Items, qty, cost, vendor per week', type: 'purchases' },
    { icon: '📋', title: 'Expenses', desc: 'Monthly costs by category', type: 'expenses' },
    { icon: '📦', title: 'Inventory', desc: 'Products, stock, margins', type: 'inventory' },
  ];

  return (<div>
    <PageHeader title="📥 Export Data" subtitle="Download CSV for any date range" />
    <DateBar preset={preset} onPreset={selectPreset} startDate={range.start} endDate={range.end} onStartChange={setStart} onEndChange={setEnd} />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
      {cards.map(c => (<div key={c.type} className="bg-sw-card rounded-xl p-5 border border-sw-border">
        <div className="text-3xl mb-2.5">{c.icon}</div>
        <h3 className="text-sw-text text-base font-bold mb-1">{c.title}</h3>
        <p className="text-sw-sub text-xs mb-4">{c.desc}</p>
        <Button variant="secondary" onClick={() => exportData(c.type)} className="!text-[11px]">📥 Download CSV</Button>
      </div>))}
    </div>
  </div>);
}
