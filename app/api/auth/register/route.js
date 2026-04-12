import { createClient, createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // Verify caller is owner
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner access required' }, { status: 403 });

    const { email, password, name, role, store_id } = await request.json();
    if (!email || !password || !name) return NextResponse.json({ error: 'Email, password, and name required' }, { status: 400 });

    // Create auth user with admin client
    const admin = createAdminClient();
    const { data: newUser, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });

    // Create profile
    const { error: profileErr } = await admin.from('profiles').insert({
      id: newUser.user.id,
      username: email.split('@')[0],
      name,
      role: role || 'employee',
      store_id: role === 'owner' ? null : store_id,
    });

    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 400 });

    return NextResponse.json({ success: true, user: { id: newUser.user.id, email, name, role } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
