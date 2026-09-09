// Shared HTTP layer for every NRS API call.
//
// NRS (pos-papi.nrsplus.com) intermittently answers with a 5xx and an EMPTY
// body. A single-shot fetch turned that into a hard failure: because the sync
// cron runs once a day, one blip meant a store's sales for that day were
// simply never imported, and the log line read `NRS API 500:` — a status with
// nothing after the colon, which tells the owner nothing about what to do.
//
// This module centralises three things:
//   1. retry with exponential backoff on transient failures,
//   2. a request timeout, so a hung socket can't stall the whole cron,
//   3. errors that carry structured detail (endpoint, status, attempts, body)
//      and a plain-English hint, so the Agent Logs are actionable.

const NRS_BASE = process.env.NRS_API_BASE || 'https://pos-papi.nrsplus.com';

// Statuses worth retrying: NRS is briefly unavailable or throttling us.
// 4xx other than 408/429 means the request itself is wrong — retrying an
// expired token or a bad store id just wastes the cron's time budget.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const BASE_BACKOFF_MS = 800;

export class NrsApiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'NrsApiError';
    this.detail = detail;
  }
}

// The merchant token sits in the URL path, so any URL we log or store has to
// be scrubbed first.
export function redactToken(str) {
  const token = process.env.NRS_USER_TOKEN || '';
  if (!token || !str) return str || '';
  return String(str).split(token).join(`${token.slice(0, 6)}…`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Full jitter — five stores retrying in lockstep would re-create the very
// thundering herd that may have caused the 500s in the first place.
function backoffMs(attempt, base = BASE_BACKOFF_MS) {
  const ceiling = base * 2 ** (attempt - 1);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

function hintFor(status, bodyText) {
  if (status === 401 || status === 403) {
    return 'NRS rejected the token — set a fresh NRS_USER_TOKEN.';
  }
  if (status === 429) {
    return 'NRS is rate-limiting this token; the sync will back off and retry.';
  }
  if (status >= 500 && !bodyText) {
    // The exact shape seen in the Agent Logs: a 5xx with nothing in the body.
    return 'NRS returned an error with an empty body — the NRS API is down or the NRS_USER_TOKEN has expired. The status strip at the top of the app shows "NRS Invalid" when it is the token.';
  }
  if (status >= 500) return 'NRS server error. This is on the NRS side, not the data we sent.';
  return '';
}

/**
 * Fetch an NRS endpoint and return parsed JSON, retrying transient failures.
 *
 * @param {string} path  Path after the token, e.g. `pcrhist/123/stats/day/...`.
 * @param {object} opts
 *   - method, headers, body  standard fetch options
 *   - label       short endpoint name used in errors (defaults to the path)
 *   - context     extra key/values folded into the error message, e.g. { store: 'Reno' }
 *   - attempts    max tries including the first (default 3)
 *   - timeoutMs   per-attempt timeout (default 20s)
 *   - retryOn500  retry plain 500s (default true for GET, false for writes)
 *   - baseBackoffMs  first-retry delay ceiling (default 800ms)
 * @throws {NrsApiError} with `.detail` describing every attempt.
 */
export async function nrsFetchJson(path, opts = {}) {
  const token = process.env.NRS_USER_TOKEN || '';
  if (!token) throw new NrsApiError('NRS_USER_TOKEN not configured', { hint: 'Set NRS_USER_TOKEN in the environment.' });

  const {
    method = 'GET',
    headers = {},
    body,
    label = path.split('?')[0],
    context = {},
    attempts = DEFAULT_ATTEMPTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryOn500 = method === 'GET',
    baseBackoffMs = BASE_BACKOFF_MS,
  } = opts;

  const url = `${NRS_BASE}/${token}/${path}`;
  const where = Object.entries(context).map(([k, v]) => `${k} ${v}`).join(', ');
  const tries = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res, bodyText = '', networkError = null;

    try {
      res = await fetch(url, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      networkError = e?.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : (e?.message || String(e));
    }

    if (networkError) {
      tries.push({ attempt, error: networkError });
      if (attempt < attempts) {
        console.warn(`[nrs] ${label} attempt ${attempt}/${attempts} failed (${networkError}) — retrying`);
        await sleep(backoffMs(attempt, baseBackoffMs));
        continue;
      }
      throw new NrsApiError(
        `NRS ${label}${where ? ` (${where})` : ''} unreachable after ${attempts} attempts: ${networkError}`,
        { label, method, status: null, attempts, tries, hint: 'Network or timeout reaching NRS — no response was received.' },
      );
    }

    if (res.ok) {
      if (attempt > 1) console.log(`[nrs] ${label} succeeded on attempt ${attempt}/${attempts}`);
      return res.json();
    }

    bodyText = (await res.text().catch(() => '')).trim();
    tries.push({ attempt, status: res.status, body: bodyText.slice(0, 200) });

    const retryable = RETRYABLE_STATUS.has(res.status) && (res.status !== 500 || retryOn500);
    if (retryable && attempt < attempts) {
      console.warn(`[nrs] ${label} attempt ${attempt}/${attempts} → ${res.status} — retrying`);
      await sleep(backoffMs(attempt, baseBackoffMs));
      continue;
    }

    const hint = hintFor(res.status, bodyText);
    // The body is spelled out as "(empty response body)" rather than left as a
    // dangling colon, which is what made the original log entries unreadable.
    const detailText = bodyText ? bodyText.slice(0, 200) : '(empty response body)';
    throw new NrsApiError(
      `NRS ${label}${where ? ` (${where})` : ''} → ${res.status} after ${attempt} attempt${attempt > 1 ? 's' : ''}: ${detailText}${hint ? ` — ${hint}` : ''}`,
      { label, method, status: res.status, attempts: attempt, tries, body: bodyText.slice(0, 500), hint },
    );
  }
}
