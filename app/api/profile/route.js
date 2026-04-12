// Server-side profile lookup that bypasses RLS by using the service role key.
// The browser client calls this after sign-in instead of reading `profiles`
// directly, so a misconfigured RLS policy can never stall the UI again.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Identify the caller from their auth cookie using the normal SSR client.
    const supabase = createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ profile: null, error: 'not_authenticated' }, { status: 401 });
    }

    // Read the profiles row using the service role key so RLS is irrelevant.
    const admin = createAdminClient();
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr) {
      console.error('[api/profile] admin query error:', profileErr);
      return NextResponse.json({
        profile: {
          id: user.id,
          name: user.email,
          role: 'owner',
          store_id: null,
          username: user.email ? user.email.split('@')[0] : 'user',
          __fallback: true,
        },
        warning: profileErr.message,
      });
    }

    if (!profile) {
      return NextResponse.json({
        profile: {
          id: user.id,
          name: user.email,
          role: 'owner',
          store_id: null,
          username: user.email ? user.email.split('@')[0] : 'user',
          __fallback: true,
        },
        warning: 'no_profile_row',
      });
    }

    return NextResponse.json({ profile });
  } catch (e) {
    console.error('[api/profile] unexpected:', e);
    return NextResponse.json({ profile: null, error: e?.message || 'unknown' }, { status: 500 });
  }
}
