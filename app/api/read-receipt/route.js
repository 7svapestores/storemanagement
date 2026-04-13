// Reads cash-register shift report + safe drop receipt screenshots via
// Anthropic's Claude API and returns the extracted numbers.
//
// Requires ANTHROPIC_API_KEY in the environment.
// Called from the Daily Sales page before submitting entries.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // allow slow vision calls

const MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(apiKey, imageBase64, prompt) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  // Strip any stray markdown fences just in case.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Couldn't parse Claude response: ${cleaned.slice(0, 200)}`);
  }
}

export async function POST(request) {
  try {
    // Require an authenticated user (any role — employees need this too).
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured on the server' }, { status: 500 });
    }

    const { shiftReportBase64, safeDropBase64 } = await request.json();
    if (!shiftReportBase64 || !safeDropBase64) {
      return NextResponse.json({ error: 'Both shift_report and safe_drop images are required' }, { status: 400 });
    }

    // Run both reads in parallel to save latency.
    const [shiftReport, safeDrop] = await Promise.all([
      callClaude(apiKey, shiftReportBase64,
        'Read this cash register shift report receipt carefully. Extract these exact numbers. ' +
        'Return ONLY valid JSON with no other text, no markdown, no backticks: ' +
        '{"grossSales": 0, "netSales": 0, "cashSales": 0, "cardSales": 0, "salesTax": 0, "canceledBasket": 0}. ' +
        'Use the actual dollar amounts as numbers without $ signs. If a field is not found, use 0.'
      ),
      callClaude(apiKey, safeDropBase64,
        'Read this safe drop receipt. Extract the total safe drop amount. ' +
        'Return ONLY valid JSON: {"safeDrop": 0}. Use the dollar amount as a number without $ sign.'
      ),
    ]);

    return NextResponse.json({
      shiftReport,
      safeDrop,
    });
  } catch (err) {
    console.error('[api/read-receipt] error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to read receipt' }, { status: 500 });
  }
}
