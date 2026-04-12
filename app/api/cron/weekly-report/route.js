import { createAdminClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

// This endpoint can be triggered by Vercel Cron or external cron service
// Add to vercel.json: { "crons": [{ "path": "/api/cron/weekly-report", "schedule": "0 7 * * 1" }] }

export async function GET(request) {
  // Simple auth check for cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    const { data: stores } = await supabase.from('stores').select('*').eq('is_active', true);
    const { data: settings } = await supabase.from('email_settings').select('*').limit(1).single();

    if (!settings?.enabled) return NextResponse.json({ message: 'Email reports disabled' });

    // Last week range
    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - now.getDay() - 6);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    const startDate = lastMonday.toISOString().split('T')[0];
    const endDate = lastSunday.toISOString().split('T')[0];

    const reports = [];
    for (const store of (stores || [])) {
      const [{ data: sales }, { data: purch }] = await Promise.all([
        supabase.from('daily_sales').select('total_sales, cash_sales, card_sales, credits, tax_collected')
          .eq('store_id', store.id).gte('date', startDate).lte('date', endDate),
        supabase.from('purchases').select('total_cost')
          .eq('store_id', store.id).gte('week_of', startDate).lte('week_of', endDate),
      ]);

      reports.push({
        store: store.name,
        email: store.email,
        totalSales: sales?.reduce((s, r) => s + (r.total_sales || 0), 0) || 0,
        cashSales: sales?.reduce((s, r) => s + (r.cash_sales || 0), 0) || 0,
        cardSales: sales?.reduce((s, r) => s + (r.card_sales || 0), 0) || 0,
        purchases: purch?.reduce((s, r) => s + (r.total_cost || 0), 0) || 0,
        tax: sales?.reduce((s, r) => s + (r.tax_collected || 0), 0) || 0,
      });
    }

    // In production: send emails via nodemailer/SendGrid
    // For now, return the report data
    return NextResponse.json({
      message: 'Weekly report generated',
      period: { start: startDate, end: endDate },
      reports,
      ownerEmail: settings.owner_email,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
