// NRS pricebook integration — list items and update prices.
//
// All calls use the same merchant path-token auth as lib/nrs-client.js
// (NRS_USER_TOKEN, e.g. "u43912-…"). The token is sent in the URL path,
// not a header. Endpoints and payload shapes were reverse-engineered from
// the NRS merchant portal (mystore.nrsplus.com) network traffic.
//
// Price updates are a read-modify-write: we fetch the item's current full
// record, change ONLY the price (`cents`), and POST the complete record
// back — exactly as the portal does — so no other item data is clobbered.

import { nrsFetchJson } from '@/lib/nrs-fetch';

const NRS_TOKEN = process.env.NRS_USER_TOKEN || '';

const NRS_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://mystore.nrsplus.com',
  'Referer': 'https://mystore.nrsplus.com/',
};

function assertToken() {
  if (!NRS_TOKEN) throw new Error('NRS_USER_TOKEN not configured');
}

async function nrsGet(path) {
  assertToken();
  return nrsFetchJson(path, { headers: NRS_HEADERS });
}

// Writes only retry on the statuses that mean "we never got to your request"
// (429 / 502 / 503 / 504 / timeout). A bare 500 is not retried: NRS may have
// applied the price before failing, and re-POSTing a partially-applied
// read-modify-write is how you clobber item data.
async function nrsPost(path, body) {
  assertToken();
  return nrsFetchJson(path, {
    method: 'POST',
    headers: { ...NRS_HEADERS, 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(body),
    retryOn500: false,
  });
}

// DataTables-style server params expected by the pbitems list endpoint.
// We send a compact-but-valid subset of columns; ordering/searching is keyed
// off `upcorplu` (column index 1).
function buildListQuery({ search = '', start = 0, length = 25 }) {
  const cols = ['image', 'upcorplu', 'upc', 'dept', 'cents', 'desc', 'name', 'size', 'cost_cents', 'price_fmt'];
  const p = new URLSearchParams();
  p.set('draw', '1');
  cols.forEach((data, i) => {
    p.set(`columns[${i}][data]`, data);
    p.set(`columns[${i}][name]`, '');
    p.set(`columns[${i}][searchable]`, 'true');
    p.set(`columns[${i}][orderable]`, data === 'image' ? 'false' : 'true');
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  p.set('order[0][column]', '1'); // upcorplu
  p.set('order[0][dir]', 'asc');
  p.set('start', String(start));
  p.set('length', String(length));
  p.set('search[value]', search || '');
  p.set('search[regex]', 'false');
  p.set('_', String(Date.now()));
  return p.toString();
}

// Search / page the store's pricebook. Returns normalized rows for the UI.
export async function listPricebookItems(nrsStoreId, { search = '', start = 0, length = 25 } = {}) {
  const qs = buildListQuery({ search, start, length });
  const json = await nrsGet(`pbitems/${nrsStoreId}/default?${qs}`);
  const rows = Array.isArray(json?.data) ? json.data : [];
  const total = rows[0]?.recordsfiltered ?? rows.length;
  const items = rows.map((r) => ({
    upc: r.upc,
    upcorplu: r.upcorplu,
    name: r.name,
    desc: r.desc,
    dept: r.dept,
    size: r.size,
    cents: r.cents,
    price_fmt: r.price_fmt,
    cost_cents: r.cost_cents,
  }));
  return { items, recordsFiltered: total };
}

// Full detail for a single item (the authoritative current record).
export async function getPricebookItemDetail(nrsStoreId, upc) {
  const json = await nrsGet(`pbitems/${nrsStoreId}/default/${encodeURIComponent(upc)}`);
  const pb = json?.data?.pricebook;
  if (!pb) throw new Error(`Item ${upc} not found in pricebook`);
  return {
    pricebook: pb,
    master_image: json.data.master_image ?? null,
    custom_image: json.data.custom_image ?? null,
  };
}

// Store-level inventory group (cached per process — it's a store constant).
const _groupCache = new Map();
export async function getStoreInventoryGroup(nrsStoreId) {
  if (_groupCache.has(nrsStoreId)) return _groupCache.get(nrsStoreId);
  const group = await nrsGet(`inventory/${nrsStoreId}/getid`);
  _groupCache.set(nrsStoreId, group);
  return group;
}

// Per-item inventory record (best-effort — items without tracking return []).
async function getItemInventory(nrsStoreId, groupId, upc) {
  try {
    const json = await nrsGet(`inventory/${nrsStoreId}/groups/${groupId}/upcs/${encodeURIComponent(upc)}`);
    const inv = Array.isArray(json?.upcs) ? json.upcs[0] : null;
    return inv ? { ...inv, dirty: false } : null;
  } catch (e) {
    console.warn(`[nrs-pricebook] inventory lookup failed for ${upc}: ${e.message}`);
    return null;
  }
}

// All tracked inventory for a store, normalized. NRS auto-decrements on-hand
// from real sales and exposes the reorder threshold + days-to-empty, which is
// what the Auto Reorder view runs on.
export async function listInventory(nrsStoreId) {
  const group = await getStoreInventoryGroup(nrsStoreId);
  const gid = group?.group_id ?? group?.id;
  if (!gid) return [];
  const json = await nrsGet(`inventory/${nrsStoreId}/groups/${gid}/upcs`);
  const rows = Array.isArray(json?.upcs) ? json.upcs : [];
  return rows.map((r) => ({
    upc: r.upc,
    name: r.name,
    dept: r.dept,
    onhand: Number.isFinite(r.onhand) ? r.onhand : null,
    sold: r.sold ?? 0,
    added: r.added ?? 0,
    reorderPoint: r.thresholds?.cnt ?? null,
    tracked: !!r.tracked,
    salesPerDay: Number(r.sales_per_day) || 0,
    exhaustedIn: r.exhausted_in ?? null,
    alarmCnt: !!r.alarms?.cnt,
  }));
}

// Set an item's on-hand count in NRS (a physical-count correction). Setting a
// count also turns inventory tracking on for the item, after which NRS
// decrements it from real sales. Mirrors the portal's "edit track" save.
// `threshold` is the reorder point (number) or false for none.
export async function setInventoryCount(nrsStoreId, { upc, name, cnt, threshold = false }) {
  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) throw new Error('UPC is required');
  const count = Math.round(Number(cnt));
  if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid count for ${cleanUpc}: ${cnt}`);
  const group = await getStoreInventoryGroup(nrsStoreId);
  const gid = group?.group_id ?? group?.id;
  if (!gid) throw new Error('Could not resolve store inventory group');

  const body = {
    upc: cleanUpc,
    name: name || '',
    cnt: String(count),
    threshold: Number.isInteger(threshold) && threshold > 0 ? threshold : false,
  };
  const res = await nrsPost(`inventory/${nrsStoreId}/groups/${gid}/upcs`, body);
  if (!res || (res.result !== 'OK' && res.res?.rc !== 0)) {
    throw new Error(`NRS rejected count for ${cleanUpc}: ${JSON.stringify(res).slice(0, 160)}`);
  }
  return { upc: cleanUpc, cnt: count };
}

// Reassemble the exact POST body the portal sends, from the current record,
// changing only the price. Mirrors the captured save payload field-for-field.
function buildSavePayload({ pb, inventory, group, newCents, oldCents, userInfo }) {
  const ext = pb.extension || {};
  return {
    upc: pb.upc,
    upcorplu: pb.upcorplu,
    desc: pb.desc,
    name: pb.name,
    size: pb.size,
    alias: pb.alias ?? null,
    dept: pb.dept?.dept ?? pb.dept ?? 'DEFAULT', // detail nests dept; POST wants the string
    qty: pb.pricing?.qty ?? 1,
    cents: newCents,
    cost_qty: pb.pricing?.cost_qty ?? 1,
    cost_cents: pb.pricing?.cost_cents ?? 0,
    variableprice: !!pb.variableprice,
    includes_taxes: !!pb.pricing?.includes_taxes,
    includes_fees: !!pb.pricing?.includes_fees,
    fee_multiplier: pb.pricing?.fee_multiplier ?? 1,
    byweight: !!pb.pricing?.byweight,
    isebt: pb.isebt ?? null,
    deptisebt: !!pb.deptisebt,
    picpak: Array.isArray(ext.picpak) ? ext.picpak : [],
    five_digit_price: !!ext.five_digit_price,
    inventory: inventory || null,
    origupc: pb.upc,
    extension: ext,
    ismodifier: !!pb.ismodifier,
    modifier_group_list: pb.modifier_group_list || [],
    item_groups_list: pb.item_groups_list || [],
    item_groups_list_ord: pb.item_groups_list_ord || [],
    image: { master: pb.master_image ?? null, custom: pb.custom_image ?? null },
    unit_upc: pb.unit_upc ?? null,
    unit_count: pb.unit_count ?? null,
    itemGroupList: [],
    itemGroupListOrd: [],
    modifierGroupList: [],
    group: group || null,
    data_before: { cents: oldCents },
    data_after: { cents: newCents },
    user_info: userInfo,
  };
}

// Update a single item's price. newCents is an integer (e.g. 2999 = $29.99).
// Returns { upc, old_cents, new_cents } on success; throws on failure.
export async function updatePricebookItemPrice(nrsStoreId, upc, newCents, { user = '7S StoreWise' } = {}) {
  if (!Number.isInteger(newCents) || newCents < 0) {
    throw new Error(`Invalid price (cents) for ${upc}: ${newCents}`);
  }
  const [{ pricebook: pb, master_image, custom_image }, group] = await Promise.all([
    getPricebookItemDetail(nrsStoreId, upc),
    getStoreInventoryGroup(nrsStoreId),
  ]);
  pb.master_image = master_image;
  pb.custom_image = custom_image;
  const oldCents = pb.pricing?.cents ?? null;

  if (oldCents === newCents) {
    return { upc, old_cents: oldCents, new_cents: newCents, unchanged: true };
  }

  const inventory = await getItemInventory(nrsStoreId, group?.group_id ?? group?.id, upc);
  const userInfo = { user, session: Date.now() };

  const payload = buildSavePayload({ pb, inventory, group, newCents, oldCents, userInfo });
  const res = await nrsPost(`pbitems/${nrsStoreId}/default`, payload);

  if (!res || res.res?.rc !== 0) {
    throw new Error(`NRS rejected price update for ${upc}: ${JSON.stringify(res?.res || res).slice(0, 200)}`);
  }
  const confirmed = res.data?.pricing?.cents;
  return { upc, name: pb.name, old_cents: oldCents, new_cents: confirmed ?? newCents };
}

// List a store's departments (name + label). Used to populate the
// "Department" dropdown when creating items. Departments carry the tax
// settings, so a new item inherits tax from its department automatically.
export async function listDepartments(nrsStoreId) {
  const json = await nrsGet(`departments/${nrsStoreId}`);
  const data = json?.data || {};
  return Object.values(data)
    .map((d) => ({ dept: d.dept, label: d.label || d.dept }))
    .filter((d) => d.dept)
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Create a brand-new pricebook item in one store. Mirrors the portal's
// "Add Pricebook Item" save call. `cents` is the retail price in integer
// cents; `costCents` optional. Tax is applied by NRS from the department.
export async function createPricebookItem(nrsStoreId, { upc, name, size = '', dept, cents, costCents = 0 }, { user = '7S StoreWise' } = {}) {
  const cleanUpc = String(upc || '').trim();
  if (!cleanUpc) throw new Error('UPC is required');
  if (!name || !String(name).trim()) throw new Error('Item name is required');
  if (!dept) throw new Error('Department is required');
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid price (cents): ${cents}`);
  const cost = Number.isInteger(costCents) && costCents > 0 ? costCents : 0;

  const trimmedName = String(name).trim();
  const trimmedSize = String(size || '').trim();
  const desc = trimmedSize ? `${trimmedName} ${trimmedSize}` : trimmedName;
  const nowIso = new Date().toISOString();

  const payload = {
    upc: cleanUpc,
    upcorplu: cleanUpc,
    desc,
    name: trimmedName,
    size: trimmedSize,
    alias: null,
    dept,
    qty: 1,
    cents,
    cost_qty: cost > 0 ? 1 : 0,
    cost_cents: cost,
    variableprice: false,
    includes_taxes: false,
    includes_fees: false,
    fee_multiplier: 1,
    byweight: false,
    isebt: null,
    deptisebt: false,
    picpak: [],
    five_digit_price: false,
    inventory: null,
    origupc: cleanUpc,
    extension: { picpak: {}, variableprice: false, created_at: nowIso, five_digit_price: false },
    ismodifier: false,
    modifier_group_list: [],
    item_groups_list: [],
    item_groups_list_ord: [],
    image: { master: null, custom: null },
    unit_upc: null,
    unit_count: null,
    itemGroupList: [],
    itemGroupListOrd: [],
    data_before: { cents: 0, unit_count: 0 },
    data_after: { cents, unit_count: null },
    user_info: { user, session: Date.now() },
  };

  const res = await nrsPost(`pbitems/${nrsStoreId}/default`, payload);
  if (!res || res.res?.rc !== 0) {
    throw new Error(`NRS rejected new item ${cleanUpc}: ${JSON.stringify(res?.res || res).slice(0, 200)}`);
  }
  return { upc: cleanUpc, name: trimmedName, cents: res.data?.pricing?.cents ?? cents, elmer_id: res.data?.elmer_id };
}
