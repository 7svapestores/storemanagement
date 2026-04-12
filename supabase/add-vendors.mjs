// Idempotent: inserts the default smoke/vape wholesale vendors only if
// they're missing. Matching is by name.
//   node supabase/add-vendors.mjs

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULTS = [
  'Rave',
  'Frontline',
  'SmokeHub',
  'Smoke and Vape King',
  'Nepa',
  'American',
  'DXD',
];

async function main() {
  const { data: existing, error: listErr } = await supabase
    .from('vendors')
    .select('name');
  if (listErr) {
    console.error('Failed to list vendors:', listErr.message);
    process.exit(1);
  }

  const have = new Set((existing || []).map(v => v.name));
  const toInsert = DEFAULTS
    .filter(name => !have.has(name))
    .map(name => ({
      name,
      category: 'Smoke/Vape Wholesale',
      contact: '',
      phone: '',
      email: '',
      notes: '',
    }));

  if (toInsert.length === 0) {
    console.log('All default vendors already exist. Nothing to do.');
    return;
  }

  const { error: insErr } = await supabase.from('vendors').insert(toInsert);
  if (insErr) {
    console.error('Insert failed:', insErr.message);
    process.exit(1);
  }

  console.log(`Inserted ${toInsert.length} vendors: ${toInsert.map(v => v.name).join(', ')}`);
  console.log(`Skipped ${DEFAULTS.length - toInsert.length} existing.`);
}

main().catch(e => { console.error(e); process.exit(1); });
