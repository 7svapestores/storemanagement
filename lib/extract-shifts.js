export async function extractShiftsFromNRS(supabase, nrsData, storeId, shiftDate, dailySalesId) {
  const raw = nrsData?.data || nrsData || {};
  const sessions = raw.sessions || [];
  let created = 0, skipped = 0;

  for (const s of sessions) {
    if (!s.opened) continue;
    const opened = new Date(s.opened);
    const closed = s.closed ? new Date(s.closed) : null;
    const totalHours = closed ? parseFloat(((closed - opened) / 1000 / 3600).toFixed(2)) : null;

    const { error } = await supabase.from('employee_shifts').insert({
      store_id: storeId,
      shift_date: s.session_date || shiftDate,
      employee_name: s.name || 'Unknown',
      opened_at: opened.toISOString(),
      closed_at: closed ? closed.toISOString() : null,
      total_hours: totalHours,
      nrs_session_id: s.session || null,
      nrs_terminal_id: s.terminal || null,
      nrs_login_id: s.login || null,
      daily_sales_id: dailySalesId,
    });

    if (error) {
      if (error.code === '23505') { skipped++; }
      else { console.warn('[extract-shifts] insert error:', error.message); skipped++; }
    } else {
      created++;
    }
  }

  return { sessions_found: sessions.length, created, skipped };
}
