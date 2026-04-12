// Real stores setup for StoreWise — no demo data.
// Wipes all tables + auth users, then creates 5 stores, 1 owner, 5 employees.
// Run: node supabase/seed-real.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = vals.join('=').trim();
  });
} catch { console.log('No .env.local found, using environment variables'); }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

async function wipe() {
  console.log('Wiping data...');
  const tables = [
    'cash_collections', 'daily_sales', 'purchases', 'expenses',
    'inventory', 'vendors', 'email_settings', 'profiles', 'stores'
  ];
  for (const t of tables) {
    const { error } = await supabase.from(t).delete().neq('id', ZERO_UUID);
    if (error) throw new Error(`Failed to wipe ${t}: ${error.message}`);
  }

  console.log('Deleting auth users...');
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    if (!data.users.length) break;
    for (const u of data.users) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
      if (delErr) throw new Error(`Failed to delete user ${u.email}: ${delErr.message}`);
    }
    if (data.users.length < 1000) break;
    page++;
  }
}

async function seed() {
  await wipe();

  // Stores
  const storesData = [
    { name: '7s Smoke and Vape World - Bells',  color: '#F87171', tax_rate: 0.0825 },
    { name: '7s Vape Love - Kerens',            color: '#60A5FA', tax_rate: 0.0825 },
    { name: '7s Vape Love - Denison',           color: '#34D399', tax_rate: 0.0825 },
    { name: '7s Vape Love - Reno',              color: '#FBBF24', tax_rate: 0.0825 },
    { name: '7s Vape Love - Troup',             color: '#C084FC', tax_rate: 0.0825 },
  ];
  const { data: stores, error: storeErr } = await supabase.from('stores').insert(storesData).select();
  if (storeErr) throw storeErr;
  console.log(`Created ${stores.length} stores`);

  const byName = Object.fromEntries(stores.map(s => [s.name, s]));

  // Owner
  const { data: ownerAuth, error: ownerErr } = await supabase.auth.admin.createUser({
    email: 'admin@7sstores.com',
    password: 'admin123',
    email_confirm: true,
    user_metadata: { name: 'Owner', role: 'owner' }
  });
  if (ownerErr) throw ownerErr;

  const { error: ownerProfileErr } = await supabase.from('profiles').insert({
    id: ownerAuth.user.id,
    username: 'admin',
    name: 'Owner',
    role: 'owner',
    store_id: null
  });
  if (ownerProfileErr) throw ownerProfileErr;
  console.log('Created owner admin@7sstores.com');

  // Employees
  const employees = [
    { email: 'bells@7sstores.com',   username: 'bells',   name: 'Bells Employee',   storeName: '7s Smoke and Vape World - Bells' },
    { email: 'kerens@7sstores.com',  username: 'kerens',  name: 'Kerens Employee',  storeName: '7s Vape Love - Kerens' },
    { email: 'denison@7sstores.com', username: 'denison', name: 'Denison Employee', storeName: '7s Vape Love - Denison' },
    { email: 'reno@7sstores.com',    username: 'reno',    name: 'Reno Employee',    storeName: '7s Vape Love - Reno' },
    { email: 'troup@7sstores.com',   username: 'troup',   name: 'Troup Employee',   storeName: '7s Vape Love - Troup' },
  ];

  for (const emp of employees) {
    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email: emp.email,
      password: 'emp123',
      email_confirm: true,
      user_metadata: { name: emp.name, role: 'employee' }
    });
    if (authErr) throw authErr;

    const { error: profErr } = await supabase.from('profiles').insert({
      id: auth.user.id,
      username: emp.username,
      name: emp.name,
      role: 'employee',
      store_id: byName[emp.storeName].id
    });
    if (profErr) throw profErr;
    console.log(`Created employee ${emp.email} -> ${emp.storeName}`);
  }

  // Email settings
  const { error: emailErr } = await supabase.from('email_settings').insert({
    enabled: true,
    send_day: 'monday',
    owner_email: 'admin@7sstores.com'
  });
  if (emailErr) throw emailErr;
  console.log('Created email_settings');

  console.log('\n=== Login credentials ===');
  console.log('Owner:    admin@7sstores.com / admin123');
  for (const emp of employees) {
    console.log(`Employee: ${emp.email} / emp123  (${emp.storeName})`);
  }
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
