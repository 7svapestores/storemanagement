const TELEGRAM_API = 'https://api.telegram.org';

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  return { token, chatId, enabled: !!(token && chatId) };
}

export async function sendTelegram(message) {
  const { token, chatId, enabled } = getConfig();
  if (!enabled) {
    console.log('[telegram] skipped — not configured');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[telegram] API error:', data.description);
      return { sent: false, reason: data.description };
    }
    console.log('[telegram] sent successfully');
    return { sent: true };
  } catch (e) {
    console.error('[telegram] send failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

export function formatCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function buildShortOverAlert(storeName, expected, collected) {
  const diff = +(collected - expected).toFixed(2);
  if (Math.abs(diff) < 0.01) return null;
  const icon = diff > 0 ? '🟢' : '🔴';
  const label = diff > 0 ? 'OVER' : 'SHORT';
  const sign = diff > 0 ? '+' : '';
  return `${icon} <b>${storeName} — ${label}</b>\n` +
    `Expected: ${formatCurrency(expected)}\n` +
    `Collected: ${formatCurrency(collected)}\n` +
    `Difference: <b>${sign}${formatCurrency(diff)}</b>`;
}
