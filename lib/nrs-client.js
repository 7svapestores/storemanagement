const NRS_BASE = process.env.NRS_API_BASE || 'https://pos-papi.nrsplus.com';
const NRS_TOKEN = process.env.NRS_USER_TOKEN || '';

const NRS_HEADERS = {
  'Accept': 'application/json',
  'Origin': 'https://mystore.nrsplus.com',
  'Referer': 'https://mystore.nrsplus.com/',
};

function cents(v) {
  return parseFloat(((v || 0) / 100).toFixed(2));
}

export async function validateNRSAuth() {
  const debug = {
    token_present: !!NRS_TOKEN,
    token_first10: NRS_TOKEN ? NRS_TOKEN.slice(0, 10) + '...' : '',
    api_base: NRS_BASE,
    url_called: '',
    fetch_status: null,
    fetch_response_body: null,
    error_message: null,
  };
  if (!NRS_TOKEN) {
    debug.error_message = 'NRS_USER_TOKEN not set';
    console.log('[nrs/validate] no token', debug);
    return { valid: false, debug };
  }
  try {
    const url = `${NRS_BASE}/${NRS_TOKEN}/auth/validate`;
    debug.url_called = url.replace(NRS_TOKEN, NRS_TOKEN.slice(0, 10) + '...');
    console.log('[nrs/validate] calling', debug.url_called);
    const res = await fetch(url, { headers: NRS_HEADERS });
    debug.fetch_status = res.status;
    console.log('[nrs/validate] status', res.status);
    const body = await res.json().catch(() => null);
    debug.fetch_response_body = body;
    console.log('[nrs/validate] body', JSON.stringify(body).slice(0, 500));
    const valid = !!(body && body.res && body.res.rc === 0);
    console.log('[nrs/validate] valid=', valid);
    return { valid, debug };
  } catch (e) {
    debug.error_message = e.message || String(e);
    console.error('[nrs/validate] error', e);
    return { valid: false, debug };
  }
}

export async function fetchNRSDailyStats(nrsStoreId, date) {
  if (!NRS_TOKEN) throw new Error('NRS_USER_TOKEN not configured');
  const url = `${NRS_BASE}/${NRS_TOKEN}/pcrhist/${nrsStoreId}/stats/day/${date}/${date}?elmer_id=0`;
  const res = await fetch(url, { headers: NRS_HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NRS API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export function parseNRSStatsToDailySales(nrsData, storeId, date) {
  const d = nrsData || {};
  const payamts = d.payamts || {};
  const byday = d.byday || {};
  const drops = d.drops || {};
  const taxableAmt = d.taxable_amt || {};
  const collections = d.collections || {};
  const cancelBasketInfo = d.cancelbasketinfo || [];
  const sessions = d.sessions || [];

  const cashSales = cents(payamts.cash);
  const cardSales = cents(payamts.credit_debit);

  const taxKey = Object.keys(collections).find(k => k.toLowerCase().startsWith('tax'));
  const taxEntry = taxKey ? collections[taxKey] : {};
  const taxCollected = cents(taxEntry.explicit || taxEntry.amt || 0);

  const canceledBasket = cancelBasketInfo.reduce((s, c) => s + cents(c.amount || 0), 0);

  const sessionSummary = sessions.map(s => {
    const name = s.username || s.user || 'User';
    const start = s.start_time || '';
    const end = s.end_time || '';
    return `${name} ${start}-${end}`;
  }).join(', ');
  const basketCount = byday.baskets || payamts.baskets || 0;

  return {
    store_id: storeId,
    date,
    r1_gross: cents(payamts.total),
    r1_net: cents(taxableAmt.amt || byday.sales),
    gross_sales: cents(payamts.total),
    net_sales: cents(taxableAmt.amt || byday.sales),
    total_sales: cents(payamts.total),
    cash_sales: cashSales,
    card_sales: cardSales,
    cashapp_check: 0,
    r1_canceled_basket: canceledBasket,
    r1_safe_drop: cents(drops.amt),
    r1_sales_tax: taxCollected,
    tax_collected: taxCollected,
    credits: 0,
    r1_house_account_amount: 0,
    r2_net: 0,
    r2_gross: 0,
    register2_cash: 0,
    r2_safe_drop: 0,
    register2_card: 0,
    register2_credits: 0,
    r1_short_over: 0,
    r2_short_over: 0,
    notes: `Synced from NRS: ${basketCount} baskets${sessionSummary ? `, ${sessionSummary}` : ''}`,
    ai_extracted_data: nrsData,
  };
}
