import { NextResponse } from 'next/server';
import { validateNRSAuth } from '@/lib/nrs-client';

export async function GET() {
  const valid = await validateNRSAuth();
  return NextResponse.json({ valid });
}
