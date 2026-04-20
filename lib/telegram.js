const TELEGRAM_API = 'https://api.telegram.org';

function getToken() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function getOwnerChatId() {
  return process.env.TELEGRAM_CHAT_ID || '';
}

export async function sendTelegram(message, chatId) {
  const token = getToken();
  const targetChatId = chatId || getOwnerChatId();
  if (!token || !targetChatId) {
    console.log('[telegram] skipped — not configured');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[telegram] API error (chat ${targetChatId}):`, data.description);
      return { sent: false, reason: data.description };
    }
    console.log(`[telegram] sent to ${targetChatId}`);
    return { sent: true };
  } catch (e) {
    console.error('[telegram] send failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

export function formatCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildStoreDailySummary(storeName, salesData, targetDate) {
  const gross = salesData.r1_gross || salesData.gross_sales || 0;
  const net = salesData.r1_net || salesData.net_sales || 0;
  const cash = salesData.cash_sales || 0;
  const card = salesData.card_sales || 0;
  const tax = salesData.tax_collected || salesData.r1_sales_tax || 0;
  const safeDrop = (salesData.r1_safe_drop || 0) + (salesData.r2_safe_drop || 0);
  const r2Gross = salesData.r2_gross || 0;

  let msg = `<b>📊 ${storeName}</b>\n`;
  msg += `<b>Daily Sales — ${targetDate}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 Gross Sales: <b>${formatCurrency(gross)}</b>\n`;
  msg += `📈 Net Sales: <b>${formatCurrency(net)}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 Cash: ${formatCurrency(cash)}\n`;
  msg += `💳 Card: ${formatCurrency(card)}\n`;
  msg += `🏛 Tax: ${formatCurrency(tax)}\n`;
  msg += `🔐 Safe Drop: ${formatCurrency(safeDrop)}\n`;
  if (r2Gross > 0) {
    msg += `\n📋 Register 2: ${formatCurrency(r2Gross)}\n`;
  }

  return msg;
}

export function buildSyncSummaryMessage(results, targetDate, shortOverAlerts) {
  const created = results.filter(r => r.status === 'created');
  const skipped = results.filter(r => r.status === 'skipped');
  const failed = results.filter(r => r.status === 'failed');

  let msg = `<b>📊 NRS Daily Sync — ${targetDate}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  if (created.length) {
    msg += `\n✅ <b>Synced (${created.length})</b>\n`;
    created.forEach(r => { msg += `  • ${r.store_name}\n`; });
  }
  if (skipped.length) {
    msg += `\n⏭ <b>Skipped (${skipped.length})</b>\n`;
    skipped.forEach(r => { msg += `  • ${r.store_name}\n`; });
  }
  if (failed.length) {
    msg += `\n❌ <b>Failed (${failed.length})</b>\n`;
    failed.forEach(r => { msg += `  • ${r.store_name}: ${r.error}\n`; });
  }

  if (shortOverAlerts && shortOverAlerts.length > 0) {
    msg += `\n🚨 <b>Short/Over Alerts</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    shortOverAlerts.forEach(a => {
      const icon = a.diff > 0 ? '🟢 Over' : '🔴 Short';
      const sign = a.diff > 0 ? '+' : '';
      msg += `\n<b>${a.store_name}</b>\n`;
      msg += `  Expected: ${formatCurrency(a.expected)}\n`;
      msg += `  Collected: ${formatCurrency(a.collected)}\n`;
      msg += `  ${icon}: <b>${sign}${formatCurrency(a.diff)}</b>\n`;
    });
  }

  return msg;
}
