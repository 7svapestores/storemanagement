import { createClient, createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // Verify caller is owner.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'owner') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
    }

    const { userId } = await request.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    // Refuse to let the owner delete themselves.
    if (userId === user.id) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Delete profile row first (cascades in our schema would also handle this,
    // but we're explicit so the order is deterministic).
    const { error: profileErr } = await admin.from('profiles').delete().eq('id', userId);
    if (profileErr) console.warn('[api/auth/delete] profile delete error:', profileErr);

    // Delete the auth user. This cascades to any FK references using ON DELETE.
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
