import { NextResponse } from 'next/server';
import { validateNRSAuth } from '@/lib/nrs-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  console.log('[api/nrs/validate] called');
  const result = await validateNRSAuth();
  console.log('[api/nrs/validate] result', JSON.stringify(result).slice(0, 500));
  return NextResponse.json(result);
}
