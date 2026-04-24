'use client';
import { useAuth } from './AuthProvider';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';

/* ── Icon primitives ──────────────────────────────────────
   Lightweight inline SVGs. 16px, 1.75 stroke, currentColor.
   Kept in one place so the sidebar stays visually consistent. */
const Svg = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
    {children}
  </svg>
);
const I = {
  dashboard: <Svg><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Svg>,
  trends:    <Svg><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></Svg>,
  sales:     <Svg><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></Svg>,
  cash:      <Svg><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></Svg>,
  cart:      <Svg><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></Svg>,
  restock:   <Svg><path d="M3 3h5l2 4h11v10H3z"/><path d="M8 11h8"/><path d="M12 7v8"/></Svg>,
  invoice:   <Svg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></Svg>,
  expense:   <Svg><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></Svg>,
  inventory: <Svg><path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/></Svg>,
  pl:        <Svg><line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="20" y1="20" x2="20" y2="8"/></Svg>,
  compare:   <Svg><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></Svg>,
  activity:  <Svg><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></Svg>,
  export:    <Svg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Svg>,
  employee:  <Svg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></Svg>,
  admin:     <Svg><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Svg>,
  mail:      <Svg><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></Svg>,
  zap:       <Svg><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Svg>,
  bot:       <Svg><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 2v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></Svg>,
  refresh:   <Svg><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></Svg>,
  settings:  <Svg><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.14.67.38.9.68"/></Svg>,
  tag:       <Svg><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></Svg>,
  logout:    <Svg><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Svg>,
  more:      <Svg><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></Svg>,
};

export default function Sidebar({ selectedStore, onStoreChange }) {
  const { profile, signOut, isOwner, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    supabase.from('stores').select('*').order('created_at').then(({ data }) => setStores(data || []));
  }, []);

  // Grouped navigation for owner — mirrors the mockup's section layout.
  const sections = isOwner ? [
    { title: 'Overview', items: [
      { path: '/dashboard', icon: I.dashboard, label: 'Dashboard' },
      { path: '/trends',    icon: I.trends,    label: 'Trends' },
    ]},
    { title: 'Operations', items: [
      { path: '/sales',      icon: I.sales,     label: 'Daily Sales' },
      { path: '/cash',       icon: I.cash,      label: 'Cash Collection' },
      { path: '/purchases',  icon: I.cart,      label: 'Product Buying' },
      { path: '/restock',    icon: I.restock,   label: 'Restock' },
      { path: '/invoices',   icon: I.invoice,   label: 'Invoices' },
      { path: '/expenses',   icon: I.expense,   label: 'Expenses' },
      { path: '/inventory',  icon: I.inventory, label: 'Inventory' },
      { path: '/warehouse-prices', icon: I.tag,  label: 'Warehouse Prices' },
    ]},
    { title: 'Reports', items: [
      { path: '/reports',  icon: I.pl,       label: 'P&L Report' },
      { path: '/compare',  icon: I.compare,  label: 'Compare Stores' },
      { path: '/activity', icon: I.activity, label: 'Activity Log' },
      { path: '/exports',  icon: I.export,   label: 'Export Data' },
    ]},
    { title: 'Management', items: [
      { path: '/employee-tracking', icon: I.employee, label: 'Employee Tracking' },
      { path: '/team',              icon: I.admin,    label: 'Admin' },
      { path: '/email',             icon: I.mail,     label: 'Email Reports' },
    ]},
    { title: 'System', items: [
      { path: '/nrs-backfill',      icon: I.zap,      label: 'NRS Backfill' },
      { path: '/nrs-sync-history',  icon: I.bot,      label: '7S Agent Logs' },
      { path: '/cron-setup',        icon: I.refresh,  label: '7S Agent Setup' },
      { path: '/settings',          icon: I.settings, label: 'Settings' },
    ]},
  ] : [
    { title: null, items: [
      { path: '/sales',     icon: I.sales,     label: 'Enter Sales' },
      { path: '/inventory', icon: I.inventory, label: 'Inventory' },
      { path: '/restock',   icon: I.restock,   label: 'Restock' },
    ]},
  ];

  // Flattened list used by mobile bottom nav.
  const nav = sections.flatMap(s => s.items);

  // Mobile bottom nav: 4 primary items + More (owner); employees get their 2 pages.
  const primaryPaths = ['/dashboard', '/sales', '/cash', '/inventory'];
  const primary = isOwner ? nav.filter(n => primaryPaths.includes(n.path)) : nav;
  const overflow = isOwner ? nav.filter(n => !primaryPaths.includes(n.path)) : [];

  const storeName = stores.find(s => s.id === profile?.store_id)?.name;
  const go = (path) => { setMoreOpen(false); router.push(path); };

  const NavButton = ({ item }) => {
    const active = pathname === item.path;
    return (
      <button
        onClick={() => router.push(item.path)}
        className={`w-full flex items-center gap-2.5 py-2 px-2.5 rounded-md text-[12.5px] text-left transition-colors
          ${active
            ? 'bg-sw-card2 text-sw-text font-semibold'
            : 'text-sw-sub hover:bg-sw-card2/60 hover:text-sw-text'}`}
      >
        <span className={active ? 'text-sw-text' : 'text-sw-sub'}>{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <div className="hidden md:flex fixed left-0 top-0 w-[230px] h-screen z-40 bg-sw-card border-r border-sw-border flex-col overflow-y-auto">
        {/* Logo */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-[15px]
            bg-gradient-to-br from-[#C084FC] to-[#FF1493] shadow-[0_0_18px_rgba(192,132,252,0.35)]">
            7
          </div>
          <div className="text-[15px] font-extrabold tracking-tight leading-none">
            <span className="text-sw-text">Vape </span>
            <span className="neon-pink">L♥ve</span>
          </div>
        </div>

        {/* Store selector (owner only) */}
        {isOwner && stores.length > 0 && (
          <div className="px-3 pb-3">
            <select
              value={selectedStore || ''}
              onChange={e => onStoreChange(e.target.value || null)}
              className="w-full text-[12px] py-2 px-2.5 rounded-md bg-sw-card2 border border-sw-border text-sw-text cursor-pointer"
            >
              <option value="">All Stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* Employee store badge */}
        {!isOwner && storeName && (
          <div className="px-4 pb-3">
            <div className="text-sw-dim text-[9px] font-bold uppercase tracking-wider">Your Store</div>
            <div className="text-sw-text text-xs font-semibold mt-0.5">{storeName}</div>
          </div>
        )}

        {/* Grouped nav */}
        <nav className="px-2 flex-1 pb-2">
          {sections.map((section, i) => (
            <div key={i} className={i === 0 ? 'mb-1' : 'mt-4 mb-1'}>
              {section.title && (
                <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sw-dim">
                  {section.title}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map(item => <NavButton key={item.path} item={item} />)}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="p-2.5 border-t border-sw-border">
          <div className="flex items-center gap-2 p-1.5 mb-1.5">
            <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold
              ${isOwner ? 'bg-sw-blue text-black' : 'bg-sw-blueD text-sw-blue'}`}>
              {profile?.name?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sw-text text-[11px] font-semibold truncate">{profile?.name}</div>
              <div className="text-sw-dim text-[9px] capitalize">{profile?.role}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <ThemeToggle />
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] font-bold bg-sw-redD text-sw-red border border-sw-red/30 hover:bg-sw-red/20 transition-colors"
          >
            {I.logout}
            Sign Out
          </button>
        </div>
      </div>

      {/* ── Mobile top bar (logo + store selector) ─────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sw-card border-b border-sw-border flex items-center gap-2 px-3"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(48px + env(safe-area-inset-top))' }}
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-extrabold text-[12px]
          bg-gradient-to-br from-[#C084FC] to-[#FF1493]">
          7
        </div>
        <span className="text-[14px] font-extrabold tracking-tight">
          <span className="text-sw-text">Vape </span>
          <span className="neon-pink">L♥ve</span>
        </span>
        <div className="flex-1" />
        {isOwner && stores.length > 0 && (
          <select value={selectedStore || ''} onChange={e => onStoreChange(e.target.value || null)}
            className="!w-auto !min-h-0 !py-1 !px-2 !text-[11px] max-w-[140px]">
            <option value="">All Stores</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {!isOwner && storeName && (
          <span className="text-sw-text text-[11px] font-semibold truncate max-w-[140px]">{storeName}</span>
        )}
      </div>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-sw-card border-t border-sw-border flex items-stretch h-[60px] pb-[env(safe-area-inset-bottom)]">
        {primary.map(n => {
          const active = pathname === n.path;
          return (
            <button key={n.path} onClick={() => go(n.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px]
                ${active ? 'text-sw-blue' : 'text-sw-sub'}`}>
              {n.icon}
              <span className="text-[9px] font-semibold uppercase tracking-wide">{n.label.split(' ')[0]}</span>
            </button>
          );
        })}
        {overflow.length > 0 && (
          <button onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-sw-sub">
            {I.more}
            <span className="text-[9px] font-semibold uppercase tracking-wide">More</span>
          </button>
        )}
        {!isOwner && (
          <button onClick={signOut}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-sw-red">
            {I.logout}
            <span className="text-[9px] font-semibold uppercase tracking-wide">Sign Out</span>
          </button>
        )}
      </nav>

      {/* ── Mobile "more" sheet ─────────────────────────── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full bg-sw-card border-t border-sw-border rounded-t-2xl p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] max-h-[70vh] overflow-auto">
            <div className="flex justify-between items-center mb-3 px-1">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[12px] font-bold
                  ${isOwner ? 'bg-sw-blue text-black' : 'bg-sw-blueD text-sw-blue'}`}>
                  {profile?.name?.[0]}
                </div>
                <div>
                  <div className="text-sw-text text-xs font-semibold">{profile?.name}</div>
                  <div className="text-sw-dim text-[10px] capitalize">{profile?.role}</div>
                </div>
              </div>
              <button onClick={() => setMoreOpen(false)} className="text-sw-dim text-xl w-10 h-10 flex items-center justify-center">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {overflow.map(n => {
                const active = pathname === n.path;
                return (
                  <button key={n.path} onClick={() => go(n.path)}
                    className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border min-h-[72px]
                      ${active ? 'bg-sw-blueD text-sw-blue border-sw-blue/20' : 'text-sw-sub border-sw-border bg-sw-card2'}`}>
                    {n.icon}
                    <span className="text-[10px] font-semibold text-center leading-tight">{n.label}</span>
                  </button>
                );
              })}
              <button onClick={() => { setMoreOpen(false); signOut(); }}
                className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border text-sw-red border-sw-red/20 bg-sw-redD min-h-[72px]">
                {I.logout}
                <span className="text-[10px] font-semibold">Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
