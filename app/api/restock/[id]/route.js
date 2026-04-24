import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

// Load one request + items + store. Returns null if not found.
async function loadRequest(admin, id) {
  const { data: request, error } = await admin
    .from('restock_requests')
    .select(`
      id, store_id, created_by, status, note, created_at, updated_at,
      stores ( id, name, color )
    `)
    .eq('id', id)
    .single();
  if (error || !request) return null;

  const { data: items } = await admin
    .from('restock_request_items')
    .select('*')
    .eq('request_id', id)
    .order('created_at', { ascending: true });

  const { data: creator } = await admin
    .from('profiles')
    .select('id, name')
    .eq('id', request.created_by)
    .single();

  return {
    ...request,
    created_by_name: creator?.name || null,
    items: items || [],
  };
}

// GET /api/restock/[id]
export async function GET(req, { params }) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.is_active === false) return NextResponse.json({ error: 'Account inactive' }, { status: 403 });

    const admin = createAdminClient();
    const request = await loadRequest(admin, params.id);
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (profile.role !== 'owner' && request.store_id !== profile.store_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ request });
  } catch (e) {
    console.error('[restock/[id]/GET]', e);
    return NextResponse.json({ error: e.message || 'Load failed' }, { status: 500 });
  }
}

// PATCH /api/restock/[id]
// Body shapes:
//   { status: 'approved' | 'ordered' | 'cancelled' | 'pending' }   owner only
//   { note: string }                                               owner only
//   { items: [{ id, qty?, override_vendor?, override_unit_price? }] }  owner only
// Owners also may update items for a still-pending request.
export async function PATCH(req, { params }) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.is_active === false) return NextResponse.json({ error: 'Account inactive' }, { status: 403 });
    if (profile.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    const admin = createAdminClient();
    const existing = await loadRequest(admin, params.id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const patches = {};
    let statusChange = null;

    if (typeof body.status === 'string') {
      if (!['pending', 'approved', 'ordered', 'cancelled'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      patches.status = body.status;
      statusChange = body.status;
    }
    if (typeof body.note === 'string') patches.note = body.note.trim() || null;

    if (Object.keys(patches).length) {
      const { error } = await admin.from('restock_requests').update(patches).eq('id', params.id);
      if (error) throw error;
    }

    if (Array.isArray(body.items) && body.items.length) {
      for (const it of body.items) {
        if (!it?.id) continue;
        const update = {};
        if (typeof it.qty === 'number' && it.qty > 0) update.qty = Math.floor(it.qty);
        if ('override_vendor' in it) update.override_vendor = it.override_vendor || null;
        if ('override_unit_price' in it) {
          const v = it.override_unit_price;
          update.override_unit_price = v === null || v === '' ? null : Number(v);
        }
        if (!Object.keys(update).length) continue;
        const { error } = await admin
          .from('restock_request_items')
          .update(update)
          .eq('id', it.id)
          .eq('request_id', params.id);
        if (error) throw error;
      }
    }

    if (statusChange) {
      await logActivity(admin, profile, {
        action: statusChange === 'cancelled' ? 'cancel' : (statusChange === 'ordered' ? 'order' : 'approve'),
        entityType: 'restock_request',
        entityId: params.id,
        description: `Marked restock request as ${statusChange}`,
        metadata: { status: statusChange },
        storeName: existing.stores?.name || null,
      });
    } else {
      await logActivity(admin, profile, {
        action: 'update',
        entityType: 'restock_request',
        entityId: params.id,
        description: 'Edited restock request',
        metadata: null,
        storeName: existing.stores?.name || null,
      });
    }

    const refreshed = await loadRequest(admin, params.id);
    return NextResponse.json({ request: refreshed });
  } catch (e) {
    console.error('[restock/[id]/PATCH]', e);
    return NextResponse.json({ error: e.message || 'Update failed' }, { status: 500 });
  }
}

// DELETE /api/restock/[id]
export async function DELETE(req, { params }) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    const admin = createAdminClient();
    const existing = await loadRequest(admin, params.id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { error } = await admin.from('restock_requests').delete().eq('id', params.id);
    if (error) throw error;

    await logActivity(admin, profile, {
      action: 'delete',
      entityType: 'restock_request',
      entityId: params.id,
      description: 'Deleted restock request',
      metadata: { items: existing.items.length },
      storeName: existing.stores?.name || null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[restock/[id]/DELETE]', e);
    return NextResponse.json({ error: e.message || 'Delete failed' }, { status: 500 });
  }
}
