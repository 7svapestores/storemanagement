// Owner-only endpoint to edit an employee: rename, reassign store,
// toggle active status, and reset password. Uses the admin client so
// it bypasses RLS and can touch any row.

import { createClient, createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: callerProfile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (callerProfile?.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const { userId, name, store_id, is_active, password } = await request.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const admin = createAdminClient();

    // Profile update — only send fields that were explicitly provided.
    const profileUpdate = {};
    if (typeof name === 'string' && name.trim()) profileUpdate.name = name.trim();
    if (store_id !== undefined) profileUpdate.store_id = store_id || null;
    if (typeof is_active === 'boolean') profileUpdate.is_active = is_active;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileErr } = await admin
        .from('profiles').update(profileUpdate).eq('id', userId);
      if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 400 });
    }

    // Password reset — requires at least 6 chars.
    if (password) {
      if (typeof password !== 'string' || password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }
      const { error: authErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
