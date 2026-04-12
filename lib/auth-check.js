// Authorization helpers. Now that RLS is disabled, these are the only gate
// for what data a user can see or mutate. They are used by AppShell, the
// per-page guards, and the activity logger.

export function isOwner(profile) {
  return profile?.role === 'owner';
}

export function isEmployee(profile) {
  return profile?.role === 'employee';
}

// Owners may touch any store. Employees may only touch their assigned store.
export function canAccessStore(profile, storeId) {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  if (!storeId) return false;
  return profile.store_id === storeId;
}

// Whether this user may perform a write on a given table.
export function canMutate(profile, entityType) {
  if (!profile) return false;
  if (isOwner(profile)) return true;
  // Employees can only create daily_sales rows for their own store. Edits
  // and deletes are still owner-only.
  return false;
}

let cachedProfile = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export async function fetchProfile({ force = false } = {}) {
  if (!force && cachedProfile && Date.now() - cachedAt < TTL_MS) {
    return cachedProfile;
  }
  try {
    const res = await fetch('/api/profile', { credentials: 'include', cache: 'no-store' });
    const json = await res.json();
    cachedProfile = json?.profile || null;
    cachedAt = Date.now();
    return cachedProfile;
  } catch (e) {
    console.warn('[auth-check] fetchProfile failed:', e?.message);
    return null;
  }
}

export function clearProfileCache() {
  cachedProfile = null;
  cachedAt = 0;
}
