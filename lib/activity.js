// Activity log helper — writes audit-trail entries to the activity_log table.
// Failures are swallowed (logged to console) so a broken audit path never
// blocks the user's actual operation.

export async function logActivity(supabase, profile, { action, entityType, entityId, description, metadata, storeName }) {
  if (!supabase || !profile) {
    console.warn('[activity] skipped — missing supabase or profile', { action, entityType });
    return;
  }
  try {
    const { error } = await supabase.from('activity_log').insert({
      user_id: profile.id,
      user_name: profile.name || profile.username || 'unknown',
      user_role: profile.role || 'unknown',
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      description,
      metadata: metadata ?? null,
      store_name: storeName ?? null,
    });
    if (error) console.warn('[activity] insert failed:', error.message);
  } catch (e) {
    console.warn('[activity] insert threw:', e?.message);
  }
}

// Small formatting helpers used by callers to build consistent descriptions.
export function fmtMoney(n) {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function shortDate(d) {
  if (!d) return '';
  try {
    const s = String(d);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(d);
  }
}
