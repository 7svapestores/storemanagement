import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { extractShiftsFromNRS } from '@/lib/extract-shifts';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const userSupa = createClient();
    const { data: { user }, error: authErr } = await userSupa.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    const { data: rows } = await admin
      .from('daily_sales')
      .select('id, store_id, date, ai_extracted_data')
      .not('ai_extracted_data', 'is', null)
      .order('date', { ascending: false });

    let totalProcessed = 0, totalSessions = 0, totalCreated = 0, totalSkipped = 0;

    for (const row of (rows || [])) {
      const result = await extractShiftsFromNRS(admin, row.ai_extracted_data, row.store_id, row.date, row.id);
      totalProcessed++;
      totalSessions += result.sessions_found;
      totalCreated += result.created;
      totalSkipped += result.skipped;
    }

    return NextResponse.json({
      total_daily_sales_processed: totalProcessed,
      total_sessions_found: totalSessions,
      shifts_created: totalCreated,
      shifts_skipped: totalSkipped,
    });
  } catch (e) {
    console.error('[extract-shifts]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
