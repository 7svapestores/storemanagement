import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { getSuggestionsForItems } from '@/lib/restock-suggestions';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Resolve the caller's profile (role + store_id) from the cookie-scoped
// session. Used by every route here to gate reads and writes — RLS is
// disabled across the schema, so app code is the only guard.
async function getCaller() {
  const userSupa = createClient();
  const { data: { user } } = await userSupa.auth.getUser();
  if (!user) return { user: null, profile: null };
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, name, username, role, store_id, is_active')
    .eq('id', user.id)
    .single();
  return { user, profile: profile || null };
}

// GET /api/restock
// Owners see every request (optionally filtered by store_id / status).
// Employees see only requests from their assigned store.
export async function GET(req) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.is_active === false) return NextResponse.json({ error: 'Account inactive' }, { status: 403 });

    const admin = createAdminClient();
    const { searchParams } = new URL(req.url);
    const storeFilter = searchParams.get('store_id');
    const statusFilter = searchParams.get('status');

    let q = admin
      .from('restock_requests')
      .select(`
        id, store_id, created_by, status, note, created_at, updated_at,
        stores ( id, name, color ),
        restock_request_items ( id )
      `)
      .order('created_at', { ascending: false });

    if (profile.role !== 'owner') {
      if (!profile.store_id) return NextResponse.json({ requests: [] });
      q = q.eq('store_id', profile.store_id);
    } else {
      if (storeFilter) q = q.eq('store_id', storeFilter);
      if (statusFilter) q = q.eq('status', statusFilter);
    }

    const { data, error } = await q;
    if (error) throw error;

    const creatorIds = Array.from(new Set((data || []).map(r => r.created_by).filter(Boolean)));
    const nameById = new Map();
    if (creatorIds.length) {
      const { data: people } = await admin.from('profiles').select('id, name').in('id', creatorIds);
      for (const p of people || []) nameById.set(p.id, p.name);
    }

    return NextResponse.json({
      requests: (data || []).map(r => ({
        id: r.id,
        store_id: r.store_id,
        store: r.stores ? { id: r.stores.id, name: r.stores.name, color: r.stores.color } : null,
        created_by: r.created_by,
        created_by_name: nameById.get(r.created_by) || null,
        status: r.status,
        note: r.note,
        created_at: r.created_at,
        updated_at: r.updated_at,
        item_count: r.restock_request_items?.length || 0,
      })),
    });
  } catch (e) {
    console.error('[restock/GET]', e);
    return NextResponse.json({ error: e.message || 'List failed' }, { status: 500 });
  }
}

// POST /api/restock
// Body: { items: [{ product_name, upc?, variant?, qty }], note?, store_id? }
// Creates a restock_requests row + items with cheapest-vendor suggestions
// frozen into each item. Employees are hard-scoped to their own store.
export async function POST(req) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.is_active === false) return NextResponse.json({ error: 'Account inactive' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const note = typeof body.note === 'string' ? body.note.trim() : null;

    // Employees are pinned to their assigned store. Owners can submit for any
    // store (falls back to their selected store from the body).
    let storeId = null;
    if (profile.role === 'owner') {
      storeId = body.store_id || null;
    } else {
      storeId = profile.store_id || null;
    }
    if (!storeId) return NextResponse.json({ error: 'No store assigned' }, { status: 400 });

    // Minimal validation — drop anything without a name or a positive qty.
    const cleaned = items
      .map(i => ({
        product_name: String(i.product_name || '').trim(),
        upc: i.upc ? String(i.upc).trim() : null,
        variant: i.variant ? String(i.variant).trim() : null,
        qty: Math.max(1, parseInt(i.qty, 10) || 0),
      }))
      .filter(i => i.product_name && i.qty > 0);
    if (!cleaned.length) return NextResponse.json({ error: 'No items to submit' }, { status: 400 });

    const admin = createAdminClient();

    // Freeze the cheapest-vendor suggestion into each item so later invoice
    // ingests can't silently re-rank an approved PO.
    const suggestions = await getSuggestionsForItems(admin, cleaned);

    const { data: request, error: reqErr } = await admin
      .from('restock_requests')
      .insert({
        store_id: storeId,
        created_by: user.id,
        status: 'pending',
        note: note || null,
      })
      .select('id')
      .single();
    if (reqErr) throw reqErr;

    const itemRows = suggestions.map(s => ({
      request_id: request.id,
      product_name: s.product_name,
      upc: s.upc,
      variant: s.variant,
      qty: s.qty,
      suggested_vendor: s.suggested_vendor,
      suggested_unit_price: s.suggested_unit_price,
      suggested_invoice_id: s.suggested_invoice_id,
    }));
    const { error: itemsErr } = await admin.from('restock_request_items').insert(itemRows);
    if (itemsErr) throw itemsErr;

    const { data: store } = await admin.from('stores').select('name').eq('id', storeId).single();
    await logActivity(admin, profile, {
      action: 'create',
      entityType: 'restock_request',
      entityId: request.id,
      description: `Submitted restock request with ${itemRows.length} ${itemRows.length === 1 ? 'item' : 'items'}`,
      metadata: { items: itemRows.length, status: 'pending' },
      storeName: store?.name || null,
    });

    return NextResponse.json({ ok: true, request_id: request.id });
  } catch (e) {
    console.error('[restock/POST]', e);
    return NextResponse.json({ error: e.message || 'Submit failed' }, { status: 500 });
  }
}
