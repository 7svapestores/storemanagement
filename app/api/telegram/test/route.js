import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { sendTelegram } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const userSupa = createClient();
    const { data: { user } } = await userSupa.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      return NextResponse.json({
        success: false,
        error: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in environment variables',
      }, { status: 400 });
    }

    const result = await sendTelegram(
      '✅ <b>StoreWise Connected!</b>\n\nTelegram notifications are working. You will receive alerts when short/over is detected after NRS sync.'
    );

    return NextResponse.json({ success: result.sent, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
