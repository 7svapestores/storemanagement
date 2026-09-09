import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NRS_API_BASE = 'https://nrs.test';
process.env.NRS_USER_TOKEN = 'u43912-secret-token';

const { validateNRSAuth } = await import('@/lib/nrs-client');

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('validateNRSAuth', () => {
  const okBody = { res: { rc: 0 } };

  it('reports a healthy token', async () => {
    fetch.mockResolvedValue({ status: 200, json: async () => okBody });
    const { valid } = await validateNRSAuth();
    expect(valid).toBe(true);
  });

  it('reports a rejected token', async () => {
    fetch.mockResolvedValue({ status: 200, json: async () => ({ res: { rc: 1 } }) });
    const { valid } = await validateNRSAuth();
    expect(valid).toBe(false);
  });

  // The debug payload is returned to the browser, so it must not carry any
  // part of the merchant token.
  it('never returns token material in the debug payload', async () => {
    fetch.mockResolvedValue({ status: 200, json: async () => okBody });
    const { debug } = await validateNRSAuth();
    const serialized = JSON.stringify(debug);
    expect(serialized).not.toContain('u43912');
    expect(debug).not.toHaveProperty('token_first10');
    expect(debug.url_called).toBe('https://nrs.test/<token>/auth/validate');
    expect(debug.token_present).toBe(true);
  });
});
