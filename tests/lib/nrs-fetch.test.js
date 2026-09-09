import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads NRS_API_BASE at import time, so set it before importing.
process.env.NRS_API_BASE = 'https://nrs.test';
process.env.NRS_USER_TOKEN = 'u43912-secret-token';

const mod = await import('@/lib/nrs-fetch');
const { NrsApiError, redactToken } = mod;

// Skip the real backoff sleeps — the retry *policy* is what's under test,
// not how long it waits.
const nrsFetchJson = (path, opts = {}) => mod.nrsFetchJson(path, { baseBackoffMs: 0, ...opts });

const ok = (body = { res: { rc: 0 } }) => ({
  ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
});
const fail = (status, body = '') => ({
  ok: false, status, json: async () => null, text: async () => body,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  // Backoff sleeps are real timers; keep them at zero so the suite stays fast.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('nrsFetchJson', () => {
  it('returns parsed JSON on a first-try success', async () => {
    fetch.mockResolvedValueOnce(ok({ data: { sales: 1 } }));
    await expect(nrsFetchJson('pcrhist/1/stats')).resolves.toEqual({ data: { sales: 1 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('puts the token in the URL path, as NRS expects', async () => {
    fetch.mockResolvedValueOnce(ok());
    await nrsFetchJson('auth/validate');
    expect(fetch.mock.calls[0][0]).toBe('https://nrs.test/u43912-secret-token/auth/validate');
  });

  // The bug from the Agent Logs: one 500 killed a whole store-day.
  it('retries a 500 and succeeds on a later attempt', async () => {
    fetch.mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok({ data: 'recovered' }));
    await expect(nrsFetchJson('pcrhist/1/stats')).resolves.toEqual({ data: 'recovered' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries 429 and 503 too', async () => {
    fetch.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    await nrsFetchJson('pcrhist/1/stats');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries network errors and timeouts', async () => {
    fetch.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(ok());
    await nrsFetchJson('pcrhist/1/stats');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 — the request itself is wrong', async () => {
    fetch.mockResolvedValue(fail(404, 'no such store'));
    await expect(nrsFetchJson('pcrhist/999/stats')).rejects.toThrow(/404/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry an expired token', async () => {
    fetch.mockResolvedValue(fail(401));
    await expect(nrsFetchJson('pcrhist/1/stats')).rejects.toThrow(/fresh NRS_USER_TOKEN/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and names the endpoint and store', async () => {
    fetch.mockResolvedValue(fail(500));
    const err = await nrsFetchJson('pcrhist/1/stats', {
      label: 'daily stats', context: { store: 53039, date: '2026-09-07' },
    }).catch(e => e);

    expect(err).toBeInstanceOf(NrsApiError);
    expect(fetch).toHaveBeenCalledTimes(3);
    // Previously this read "NRS API 500:" — a status and nothing else.
    expect(err.message).toContain('daily stats (store 53039, date 2026-09-07)');
    expect(err.message).toContain('500 after 3 attempts');
    expect(err.message).toContain('(empty response body)');
    expect(err.message).toContain('NRS_USER_TOKEN has expired');
  });

  it('records structured detail for every attempt', async () => {
    fetch.mockResolvedValue(fail(500, 'boom'));
    const err = await nrsFetchJson('pcrhist/1/stats', { label: 'daily stats' }).catch(e => e);
    expect(err.detail).toMatchObject({ label: 'daily stats', method: 'GET', status: 500, attempts: 3 });
    expect(err.detail.tries).toHaveLength(3);
    expect(err.detail.tries[0]).toMatchObject({ attempt: 1, status: 500, body: 'boom' });
    expect(err.detail.hint).toBeTruthy();
  });

  // A price update is a read-modify-write; NRS may have applied it before the
  // 500, so re-POSTing risks clobbering item data.
  it('does not retry a 500 on a write', async () => {
    fetch.mockResolvedValue(fail(500));
    await expect(nrsFetchJson('pbitem/save', { method: 'POST', body: '{}', retryOn500: false })).rejects.toThrow(/500/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still retries a write when NRS never took the request (503)', async () => {
    fetch.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    await nrsFetchJson('pbitem/save', { method: 'POST', body: '{}', retryOn500: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails fast and clearly with no token configured', async () => {
    const saved = process.env.NRS_USER_TOKEN;
    delete process.env.NRS_USER_TOKEN;
    await expect(nrsFetchJson('auth/validate')).rejects.toThrow('NRS_USER_TOKEN not configured');
    expect(fetch).not.toHaveBeenCalled();
    process.env.NRS_USER_TOKEN = saved;
  });
});

describe('redactToken', () => {
  it('keeps the merchant token out of anything we log or store', () => {
    expect(redactToken('https://nrs.test/u43912-secret-token/auth/validate'))
      .toBe('https://nrs.test/u43912…/auth/validate');
  });

  it('passes through empty input', () => {
    expect(redactToken('')).toBe('');
  });
});
