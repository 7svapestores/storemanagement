// ═══════════════════════════════════════════════════════════
// StoreWise Seed Script for Supabase
// Run: node supabase/seed.mjs
//
// Prerequisites:
//   1. Create your Supabase project at supabase.com
//   2. Run schema.sql in Supabase SQL Editor
//   3. Copy .env.local.example to .env.local and fill in keys
//   4. Run this script
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env.local
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = vals.join('=').trim();
  });
} catch(e) { console.log('No .env.local found, using environment variables'); }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Copy .env.local.example to .env.local and fill in your Supabase keys');
  process.exit(1);
}

// Use service role key to bypass RLS
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function seed() {
  console.log('🌱 Seeding StoreWise database...\n');

  // ── Clean existing data ─────────────────────────────────
  console.log('  Cleaning existing data...');
  await supabase.from('cash_collections').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('daily_sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('purchases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('inventory').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('vendors').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('email_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // ── Create Stores ───────────────────────────────────────
  const storesData = [
    { name: 'Downtown Main', color: '#F87171', email: 'downtown@myshop.com', tax_rate: 0.0825 },
    { name: 'Westside Plaza', color: '#60A5FA', email: 'westside@myshop.com', tax_rate: 0.0825 },
    { name: 'Northgate Mall', color: '#34D399', email: 'northgate@myshop.com', tax_rate: 0.0825 },
    { name: 'Airport Terminal', color: '#FBBF24', email: 'airport@myshop.com', tax_rate: 0.0825 },
    { name: 'Lakefront Market', color: '#C084FC', email: 'lakefront@myshop.com', tax_rate: 0.0825 },
  ];

  const { data: stores, error: storeErr } = await supabase.from('stores').insert(storesData).select();
  if (storeErr) { console.error('Store error:', storeErr); return; }
  console.log(`  ✅ ${stores.length} stores created`);

  // ── Create Auth Users + Profiles ────────────────────────
  // Owner
  const { data: ownerAuth } = await supabase.auth.admin.createUser({
    email: 'admin@storewise.app',
    password: 'admin123',
    email_confirm: true,
    user_metadata: { name: 'Marcus Johnson', role: 'owner' }
  });

  if (ownerAuth?.user) {
    await supabase.from('profiles').insert({
      id: ownerAuth.user.id,
      username: 'admin',
      name: 'Marcus Johnson',
      role: 'owner',
      store_id: null
    });
  }

  // Employees
  const empNames = ['Sarah Chen', 'James Wilson', 'Priya Patel', 'Diego Ramirez', 'Aisha Okafor'];
  const empIds = [];
  for (let i = 0; i < empNames.length; i++) {
    const { data: empAuth } = await supabase.auth.admin.createUser({
      email: `emp${i + 1}@storewise.app`,
      password: 'emp123',
      email_confirm: true,
      user_metadata: { name: empNames[i], role: 'employee' }
    });

    if (empAuth?.user) {
      await supabase.from('profiles').insert({
        id: empAuth.user.id,
        username: `emp${i + 1}`,
        name: empNames[i],
        role: 'employee',
        store_id: stores[i].id
      });
      empIds.push(empAuth.user.id);
    }
  }
  console.log(`  ✅ ${empIds.length + 1} users created (1 owner + ${empIds.length} employees)`);

  // ── Vendors ─────────────────────────────────────────────
  const vendorsData = [
    { name: 'Tobacco Wholesale Inc', contact: 'John Smith', phone: '(555) 123-4567', email: 'john@tobaccowholesale.com', category: 'Cigarettes/Cigars' },
    { name: 'VapeWorld Distribution', contact: 'Lisa Park', phone: '(555) 234-5678', email: 'lisa@vapeworld.com', category: 'Vapes/E-Liquid' },
    { name: 'GlassCraft Supply', contact: 'Mike Torres', phone: '(555) 345-6789', email: 'mike@glasscraft.com', category: 'Glass/Pipes' },
    { name: 'CBD Direct', contact: 'Amy Chen', phone: '(555) 456-7890', email: 'amy@cbddirect.com', category: 'CBD/Kratom' },
    { name: 'General Merchandise Co', contact: 'Tom Brown', phone: '(555) 567-8901', email: 'tom@genmerch.com', category: 'Accessories' },
  ];

  const { data: vendors } = await supabase.from('vendors').insert(vendorsData).select();
  console.log(`  ✅ ${vendors.length} vendors created`);

  // ── Inventory ───────────────────────────────────────────
  const products = [
    { name: 'Marlboro Red Kings', category: 'Cigarettes', cost_price: 6.50, sell_price: 9.99, vi: 0 },
    { name: 'Camel Blue 100s', category: 'Cigarettes', cost_price: 6.20, sell_price: 9.49, vi: 0 },
    { name: 'Newport Menthol', category: 'Cigarettes', cost_price: 6.80, sell_price: 10.49, vi: 0 },
    { name: 'JUUL Pods (4pk)', category: 'Vapes/E-Cigs', cost_price: 10.00, sell_price: 18.99, vi: 1 },
    { name: 'Elf Bar 5000', category: 'Vapes/E-Cigs', cost_price: 8.50, sell_price: 16.99, vi: 1 },
    { name: 'Lost Mary OS5000', category: 'Vapes/E-Cigs', cost_price: 9.00, sell_price: 17.99, vi: 1 },
    { name: 'RAZ CA6000', category: 'Vapes/E-Cigs', cost_price: 8.00, sell_price: 15.99, vi: 1 },
    { name: 'Naked 100 E-Liquid', category: 'E-Liquid/Juice', cost_price: 8.00, sell_price: 19.99, vi: 1 },
    { name: 'RAW Rolling Papers', category: 'Rolling Papers', cost_price: 1.00, sell_price: 3.49, vi: 4 },
    { name: 'BIC Lighter 5pk', category: 'Lighters', cost_price: 3.00, sell_price: 6.99, vi: 4 },
    { name: 'Glass Water Pipe 12"', category: 'Glass/Pipes', cost_price: 15.00, sell_price: 39.99, vi: 2 },
    { name: 'Al Fakher Shisha 250g', category: 'Hookah/Shisha', cost_price: 8.00, sell_price: 16.99, vi: 4 },
    { name: 'CBD Gummies 30ct', category: 'CBD Products', cost_price: 12.00, sell_price: 29.99, vi: 3 },
    { name: 'Kratom Capsules 60ct', category: 'Kratom', cost_price: 10.00, sell_price: 24.99, vi: 3 },
    { name: 'Backwoods 5pk', category: 'Cigars', cost_price: 4.50, sell_price: 8.99, vi: 0 },
    { name: 'Swisher Sweets 2pk', category: 'Cigars', cost_price: 1.20, sell_price: 2.49, vi: 0 },
    { name: 'Clipper Lighter', category: 'Lighters', cost_price: 1.50, sell_price: 3.99, vi: 4 },
  ];

  const invRows = [];
  for (const store of stores) {
    for (const p of products) {
      invRows.push({
        store_id: store.id, name: p.name, category: p.category,
        cost_price: p.cost_price, sell_price: p.sell_price,
        stock: 5 + Math.floor(Math.random() * 80),
        reorder_level: 10, vendor_id: vendors[p.vi].id
      });
    }
  }
  await supabase.from('inventory').insert(invRows);
  console.log(`  ✅ ${invRows.length} inventory items`);

  // ── Generate 12 weeks of data ───────────────────────────
  const ownerId = ownerAuth?.user?.id;
  let salesCount = 0, purchCount = 0, expCount = 0, cashCount = 0;

  for (let w = 0; w < 12; w++) {
    const wd = new Date();
    wd.setDate(wd.getDate() - w * 7);
    const day = wd.getDay();
    const monday = new Date(wd);
    monday.setDate(wd.getDate() - day + (day === 0 ? -6 : 1));
    const mondayStr = monday.toISOString().split('T')[0];

    for (const store of stores) {
      // Purchases
      const overBuy = (w % 4 === 0 && stores.indexOf(store) < 2);
      const purchRows = [];
      for (let i = 0; i < 4 + Math.floor(Math.random() * 5); i++) {
        const prod = products[Math.floor(Math.random() * products.length)];
        const qty = 5 + Math.floor(Math.random() * 40);
        const cost = +(prod.cost_price * (overBuy ? 1.6 : 1)).toFixed(2);
        purchRows.push({
          store_id: store.id, week_of: mondayStr, item: prod.name, category: prod.category,
          quantity: qty, unit_cost: cost, supplier: vendors[prod.vi].name, vendor_id: vendors[prod.vi].id
        });
      }
      await supabase.from('purchases').insert(purchRows);
      purchCount += purchRows.length;

      // Monthly expenses
      if (w % 4 === 0) {
        const month = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}`;
        const expRows = ['power','rent','internet','pos','ccfee','water','insurance','license'].map(cat => ({
          store_id: store.id, month, category: cat,
          amount: +(200 + Math.random() * 1500).toFixed(2)
        }));
        await supabase.from('expenses').insert(expRows);
        expCount += expRows.length;
      }

      // Daily sales + cash collections
      const salesRows = [];
      const cashRows = [];
      for (let d = 0; d < 7; d++) {
        const saleDate = new Date(monday);
        saleDate.setDate(monday.getDate() + d);
        if (saleDate > new Date()) continue;
        const ds = saleDate.toISOString().split('T')[0];
        const cash = +(500 + Math.random() * 800).toFixed(2);
        const card = +(400 + Math.random() * 700).toFixed(2);

        salesRows.push({
          store_id: store.id, date: ds,
          cash_sales: cash, card_sales: card,
          credits: +(Math.random() * 80).toFixed(2),
          entered_by: ownerId
        });

        cashRows.push({
          store_id: store.id, date: ds,
          cash_collected: +(cash + (Math.random() - 0.4) * 15).toFixed(2),
          collected_by: ownerId
        });
      }

      if (salesRows.length) {
        await supabase.from('daily_sales').insert(salesRows);
        salesCount += salesRows.length;
      }
      if (cashRows.length) {
        await supabase.from('cash_collections').insert(cashRows);
        cashCount += cashRows.length;
      }
    }
  }

  console.log(`  ✅ ${salesCount} daily sales`);
  console.log(`  ✅ ${cashCount} cash collections`);
  console.log(`  ✅ ${purchCount} purchases`);
  console.log(`  ✅ ${expCount} expenses`);

  // Email settings
  await supabase.from('email_settings').insert({ enabled: true, send_day: 'monday', owner_email: 'owner@myshop.com' });
  console.log('  ✅ Email settings\n');

  console.log('🎉 Seed complete!\n');
  console.log('  Login credentials:');
  console.log('  ─────────────────────────────────');
  console.log('  Owner:    admin@storewise.app / admin123');
  console.log('  Employee: emp1@storewise.app / emp123');
  console.log('            emp2–emp5@storewise.app / emp123\n');
}

seed().catch(e => { console.error('❌ Seed failed:', e); process.exit(1); });
