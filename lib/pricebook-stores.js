// Shared helpers for the multi-store pricebook routes: owner gate, store
// lookup, and a small concurrency pool so a five-store fan-out doesn't hit
// NRS with a simultaneous burst (the pattern behind the Sep 7 sync failures).
import { createClient, createAdminClient } from '@/lib/supabase-server';

export const STORE_CONCURRENCY = 2;

export async function requireOwner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated', status: 401 };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles').select('role, name').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'owner') return { error: 'Owner access required', status: 403 };

  return { admin, profile };
}

// Stores wired up to NRS, in the app's usual display order. `ids` narrows to
// a subset; anything unknown is simply absent from the result.
export async function loadNrsStores(admin, ids = null) {
  let q = admin.from('stores').select('id, name, nrs_store_id');
  if (ids?.length) q = q.in('id', ids);
  const { data } = await q.order('created_at');
  return (data || []).filter(s => s.nrs_store_id);
}

// Promise.allSettled semantics with at most `limit` tasks in flight.
export async function mapWithConcurrency(items, limit, fn) {
  const settled = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        settled[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        settled[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return settled;
}
