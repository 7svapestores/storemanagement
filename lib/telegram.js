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

// Convention: positive short_over = SHORT (employee owes), negative = OVER (extra cash)
function formatSO(v) {
  const n = Number(v || 0);
  if (Math.abs(n) < 0.01) return { text: '$0.00', icon: '✅' };
  if (n > 0) return { text: `-${formatCurrency(n)}`, icon: '🔴' };
  return { text: `+${formatCurrency(Math.abs(n))}`, icon: '🟡' };
}

export function buildSyncSummaryMessage(results, targetDate, shortOverAlerts) {
  const withData = results.filter(r => r.salesData);
  const soEntries = [];

  // Check if any store has non-zero short/over
  let anyDiscrepancy = false;
  for (const r of results) {
    if (r.salesData) {
      const so = Number(r.salesData.short_over ?? 0);
      if (Math.abs(so) >= 0.01) anyDiscrepancy = true;
    }
  }

  let msg = `<b>📊 NRS Daily Sync — ${targetDate}</b>\n`;
  msg += anyDiscrepancy ? `⚠️ Register discrepancy flagged\n` : `✅ All registers balanced\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;

  const totals = { gross: 0, net: 0, cash: 0, card: 0 };

  for (const r of results) {
    msg += `\n`;
    if (r.status === 'failed') {
      msg += `🔴 <b>${r.store_name} — FAILED</b>\n`;
      msg += `  ${r.error || 'Unknown error'}\n`;
      continue;
    }
    const d = r.salesData;
    if (!d) {
      msg += `⏭ <b>${r.store_name}</b> — no data\n`;
      continue;
    }
    const gross = d.r1_gross || d.gross_sales || 0;
    const net = d.r1_net || d.net_sales || 0;
    const cash = d.cash_sales || 0;
    const card = d.card_sales || 0;
    const tax = d.tax_collected || d.r1_sales_tax || 0;
    const safeDrop = (d.r1_safe_drop || 0) + (d.r2_safe_drop || 0);
    const so = Number(d.short_over ?? 0);
    const soFmt = formatSO(so);
    totals.gross += gross;
    totals.net += net;
    totals.cash += cash;
    totals.card += card;
    soEntries.push({ name: r.store_name, so });

    msg += `🏪 <b>${r.store_name}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 Gross: <b>${formatCurrency(gross)}</b>\n`;
    msg += `📈 Net: <b>${formatCurrency(net)}</b>\n`;
    msg += `💵 Cash: ${formatCurrency(cash)}  💳 Card: ${formatCurrency(card)}\n`;
    msg += `🏛 Tax: ${formatCurrency(tax)}  🔐 Drop: ${formatCurrency(safeDrop)}\n`;
    msg += `⚖️ Short/Over: ${soFmt.icon} <b>${soFmt.text}</b>\n`;
  }

  // Totals
  if (withData.length > 1) {
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 <b>TOTALS (${withData.length} stores)</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 Gross: <b>${formatCurrency(totals.gross)}</b>\n`;
    msg += `📈 Net: <b>${formatCurrency(totals.net)}</b>\n`;
    msg += `💵 Cash: ${formatCurrency(totals.cash)}  💳 Card: ${formatCurrency(totals.card)}\n`;
  }

  // Short/Over summary
  if (soEntries.length > 0) {
    const netSO = soEntries.reduce((s, e) => s + e.so, 0);
    const hasIssues = soEntries.some(e => Math.abs(e.so) >= 0.01);
    if (hasIssues) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `⚖️ <b>SHORT/OVER BY STORE</b>\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      soEntries.forEach(e => {
        const f = formatSO(e.so);
        msg += `${e.name}: <b>${f.text}</b> ${f.icon}\n`;
      });
      const netFmt = formatSO(netSO);
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `Net Total: <b>${netFmt.text}</b> ${netFmt.icon}\n`;
    }
  }

  return msg;
}
