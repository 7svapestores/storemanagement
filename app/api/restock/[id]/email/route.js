import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createClient, createAdminClient } from '@/lib/supabase-server';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

function effectiveVendor(item) {
  return item.override_vendor || item.suggested_vendor || 'Unknown';
}
function effectivePrice(item) {
  const v = item.override_unit_price != null ? item.override_unit_price : item.suggested_unit_price;
  return Number(v || 0);
}

// Build a one-vendor PO PDF as a Buffer, matching the look used by the
// warehouse-prices invoice display: header + line items + totals.
function buildVendorPdf({ storeName, vendor, items, requestId, createdAt }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 40;
  let y = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Purchase Order', marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y += 22;
  doc.text(`Store: ${storeName || '—'}`, marginX, y);
  y += 14;
  doc.text(`Vendor: ${vendor}`, marginX, y);
  y += 14;
  doc.text(`Request #: ${requestId.slice(0, 8)}`, marginX, y);
  y += 14;
  const dateStr = createdAt ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  doc.text(`Date: ${dateStr}`, marginX, y);
  y += 18;

  const rows = items.map(it => {
    const price = effectivePrice(it);
    const total = price * (it.qty || 0);
    return [
      it.product_name + (it.variant ? ` (${it.variant})` : ''),
      it.upc || '',
      String(it.qty || 0),
      fmtMoney(price),
      fmtMoney(total),
    ];
  });
  const subtotal = items.reduce((s, it) => s + effectivePrice(it) * (it.qty || 0), 0);

  autoTable(doc, {
    startY: y,
    head: [['Product', 'UPC', 'Qty', 'Unit', 'Total']],
    body: rows,
    foot: [['', '', '', 'Subtotal', fmtMoney(subtotal)]],
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    margin: { left: marginX, right: marginX },
  });

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

function buildPlainTextBody({ storeName, vendor, items, requestId }) {
  const lines = [];
  lines.push(`Purchase Order — ${vendor}`);
  lines.push(`Store: ${storeName || '—'}`);
  lines.push(`Request #: ${requestId.slice(0, 8)}`);
  lines.push('');
  lines.push('Items:');
  for (const it of items) {
    const price = effectivePrice(it);
    const total = price * (it.qty || 0);
    const variant = it.variant ? ` (${it.variant})` : '';
    const upc = it.upc ? ` [${it.upc}]` : '';
    lines.push(`  - ${it.product_name}${variant}${upc}  qty ${it.qty} @ ${fmtMoney(price)} = ${fmtMoney(total)}`);
  }
  const subtotal = items.reduce((s, it) => s + effectivePrice(it) * (it.qty || 0), 0);
  lines.push('');
  lines.push(`Subtotal: ${fmtMoney(subtotal)}`);
  lines.push('');
  lines.push('Please confirm availability and estimated delivery.');
  lines.push('');
  lines.push('— StoreWise');
  return lines.join('\n');
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const userEnv = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !userEnv || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: userEnv, pass },
  });
}

// POST /api/restock/[id]/email
// Owner only. Groups items by effective vendor, looks up each vendor's email
// on the vendors table (case-insensitive name match), and sends one email per
// vendor with a PDF attachment. Skipped vendors are returned to the caller.
export async function POST(req, { params }) {
  try {
    const { user, profile } = await getCaller();
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (profile.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

    const admin = createAdminClient();
    const { data: request } = await admin
      .from('restock_requests')
      .select('id, store_id, created_at, stores ( name )')
      .eq('id', params.id)
      .single();
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: items } = await admin
      .from('restock_request_items')
      .select('*')
      .eq('request_id', params.id)
      .order('created_at', { ascending: true });

    if (!items?.length) return NextResponse.json({ error: 'No items to send' }, { status: 400 });

    // Group by effective vendor.
    const byVendor = new Map();
    for (const it of items) {
      const v = effectiveVendor(it);
      if (!byVendor.has(v)) byVendor.set(v, []);
      byVendor.get(v).push(it);
    }

    // Resolve vendor emails (case-insensitive name match).
    const vendorNames = Array.from(byVendor.keys()).filter(v => v && v !== 'Unknown');
    const emailByVendor = new Map();
    if (vendorNames.length) {
      const { data: rows } = await admin
        .from('vendors')
        .select('name, email')
        .in('name', vendorNames);
      // Fallback to case-insensitive scan if exact-match missed anything.
      const lowerSet = new Set((rows || []).map(r => (r.name || '').toLowerCase()));
      const missing = vendorNames.filter(n => !lowerSet.has(n.toLowerCase()));
      let extras = [];
      if (missing.length) {
        const { data: iRows } = await admin.from('vendors').select('name, email');
        extras = (iRows || []).filter(r =>
          missing.some(m => (r.name || '').toLowerCase() === m.toLowerCase())
        );
      }
      for (const r of [...(rows || []), ...extras]) {
        if (r.email) emailByVendor.set(r.name.toLowerCase(), r.email);
      }
    }

    const transporter = buildTransporter();
    if (!transporter) {
      return NextResponse.json(
        { error: 'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.' },
        { status: 500 }
      );
    }
    const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

    const storeName = request.stores?.name || '';
    const sent = [];
    const skipped = [];

    for (const [vendor, vendorItems] of byVendor.entries()) {
      const email = emailByVendor.get(vendor.toLowerCase());
      if (!email) {
        skipped.push({ vendor, reason: 'No email on file' });
        continue;
      }
      try {
        const pdf = buildVendorPdf({
          storeName,
          vendor,
          items: vendorItems,
          requestId: request.id,
          createdAt: request.created_at,
        });
        const text = buildPlainTextBody({
          storeName,
          vendor,
          items: vendorItems,
          requestId: request.id,
        });
        await transporter.sendMail({
          from,
          to: email,
          subject: `Purchase Order — ${storeName || 'StoreWise'}`,
          text,
          attachments: [{
            filename: `PO-${vendor.replace(/[^a-z0-9]+/gi, '-')}-${request.id.slice(0, 8)}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          }],
        });
        sent.push({ vendor, email, items: vendorItems.length });
      } catch (sendErr) {
        console.error('[restock/email] send failed', vendor, sendErr);
        skipped.push({ vendor, reason: sendErr.message || 'Send failed' });
      }
    }

    await logActivity(admin, profile, {
      action: 'email',
      entityType: 'restock_request',
      entityId: request.id,
      description: `Emailed POs — sent ${sent.length}, skipped ${skipped.length}`,
      metadata: { sent: sent.length, skipped: skipped.length },
      storeName,
    });

    return NextResponse.json({ sent, skipped });
  } catch (e) {
    console.error('[restock/[id]/email/POST]', e);
    return NextResponse.json({ error: e.message || 'Email failed' }, { status: 500 });
  }
}
