import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { validateNRSAuth } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';

// Owner-only. `/api/*` is excluded from middleware.js's auth matcher, so every
// API route has to gate itself — this one previously did not, which left the
// NRS token's prefix and the raw NRS auth response readable by anyone who
// knew the URL.
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  }

  const result = await validateNRSAuth();
  console.log('[api/nrs/validate] valid=', result.valid);
  return NextResponse.json(result);
}
