import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock('@/lib/nrs-client', () => ({ validateNRSAuth: vi.fn() }));

import { GET } from '@/app/api/nrs/validate/route';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { validateNRSAuth } from '@/lib/nrs-client';

const asUser = (user) => ({ auth: { getUser: async () => ({ data: { user } }) } });
const withRole = (role) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }),
});

function signedIn(role) {
  vi.mocked(createClient).mockReturnValue(asUser({ id: 'u1' }));
  vi.mocked(createAdminClient).mockReturnValue(withRole(role));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/nrs/validate', () => {
  it('returns the result of validateNRSAuth for an owner', async () => {
    signedIn('owner');
    vi.mocked(validateNRSAuth).mockResolvedValueOnce({ valid: true, status: 'ok' });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, status: 'ok' });
  });

  it('passes through a failing validation result', async () => {
    signedIn('owner');
    vi.mocked(validateNRSAuth).mockResolvedValueOnce({ valid: false, reason: 'auth' });
    expect(await (await GET()).json()).toEqual({ valid: false, reason: 'auth' });
  });

  // /api/* is excluded from middleware.js's matcher, so the route is the only
  // gate. Without these it leaked NRS token material to anonymous callers.
  it('rejects an anonymous caller without touching NRS', async () => {
    vi.mocked(createClient).mockReturnValue(asUser(null));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(validateNRSAuth).not.toHaveBeenCalled();
  });

  it('rejects a signed-in employee', async () => {
    signedIn('employee');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(validateNRSAuth).not.toHaveBeenCalled();
  });

  it('rejects a user with no profile row', async () => {
    signedIn(null);
    expect((await GET()).status).toBe(403);
    expect(validateNRSAuth).not.toHaveBeenCalled();
  });
});
