'use client';
import { useAuth } from './AuthProvider';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Sidebar({ selectedStore, onStoreChange }) {
  const { profile, signOut, isOwner, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    supabase.from('stores').select('*').order('created_at').then(({ data }) => setStores(data || []));
  }, []);

  const nav = isOwner ? [
    { path: '/dashboard', icon: '📊', label: 'Dashboard' },
    { path: '/trends', icon: '📈', label: 'Trends' },
    { path: '/sales', icon: '💰', label: 'Daily Sales' },
    { path: '/cash', icon: '🏦', label: 'Cash Collection' },
    { path: '/purchases', icon: '🛒', label: 'Purchases' },
    { path: '/inventory', icon: '📦', label: 'Inventory' },
    { path: '/expenses', icon: '📋', label: 'Expenses' },
    { path: '/vendors', icon: '🤝', label: 'Vendors' },
    { path: '/reports', icon: '📑', label: 'P&L Report' },
    { path: '/exports', icon: '📥', label: 'Export Data' },
    { path: '/email', icon: '📧', label: 'Email Reports' },
    { path: '/team', icon: '👥', label: 'Team' },
    { path: '/settings', icon: '⚙️', label: 'Settings' },
  ] : [
    { path: '/sales', icon: '💰', label: 'Enter Sales' },
  ];

  // Bottom nav shows 4 primary items + More (owner only); employees just get their single item.
  const primaryPaths = ['/dashboard', '/sales', '/cash', '/inventory'];
  const primary = isOwner ? nav.filter(n => primaryPaths.includes(n.path)) : nav;
  const overflow = isOwner ? nav.filter(n => !primaryPaths.includes(n.path)) : [];

  const storeName = stores.find(s => s.id === profile?.store_id)?.name;

  const go = (path) => { setMoreOpen(false); router.push(path); };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <div className="hidden md:flex w-[210px] min-h-screen bg-sw-card border-r border-sw-border flex-col flex-shrink-0 overflow-y-auto">
        {/* Logo */}
        <div className="p-3.5 border-b border-sw-border flex items-center gap-2">
          <span className="text-lg">🏪</span>
          <span className="text-[17px] font-extrabold text-sw-text">7S <span className="text-sw-blue">Stores</span></span>
        </div>

        {/* Store selector (owner only) */}
        {isOwner && stores.length > 0 && (
          <div className="px-2 pt-2">
            <select value={selectedStore || ''} onChange={e => onStoreChange(e.target.value || null)}
              className="w-full text-[11px] py-1.5 px-2 cursor-pointer">
              <option value="">All Stores</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* Employee store badge */}
        {!isOwner && storeName && (
          <div className="px-3 py-2 border-b border-sw-border">
            <div className="text-sw-sub text-[9px] font-bold uppercase">Your Store</div>
            <div className="text-sw-text text-xs font-semibold">{storeName}</div>
          </div>
        )}

        {/* Nav */}
        <nav className="p-1.5 flex-1">
          {nav.map(n => {
            const active = pathname === n.path;
            return (
              <button key={n.path} onClick={() => router.push(n.path)}
                className={`w-full flex items-center gap-2 py-[7px] px-2.5 mb-px rounded-md text-[12px] text-left transition-colors
                  ${active ? 'bg-sw-blueD text-sw-blue font-semibold border border-sw-blue/20' : 'text-sw-sub border border-transparent hover:bg-sw-card2'}`}>
                <span className="text-[13px]">{n.icon}</span>{n.label}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-2 border-t border-sw-border">
          <div className="flex items-center gap-1.5 p-1.5">
            <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-[11px] font-bold
              ${isOwner ? 'bg-sw-blue text-black' : 'bg-sw-blueD text-sw-blue'}`}>
              {profile?.name?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sw-text text-[11px] font-semibold truncate">{profile?.name}</div>
              <div className="text-sw-dim text-[9px] capitalize">{profile?.role}</div>
            </div>
            <button onClick={signOut} className="text-sw-dim hover:text-sw-text text-xs" title="Logout">⏻</button>
          </div>
        </div>
      </div>

      {/* ── Mobile top bar (logo + store selector) ─────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sw-card border-b border-sw-border flex items-center gap-2 px-3 h-12">
        <span className="text-lg">🏪</span>
        <span className="text-[15px] font-extrabold text-sw-text">7S <span className="text-sw-blue">Stores</span></span>
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
              <span className="text-[18px] leading-none">{n.icon}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wide">{n.label.split(' ')[0]}</span>
            </button>
          );
        })}
        {overflow.length > 0 && (
          <button onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-sw-sub">
            <span className="text-[18px] leading-none">⋯</span>
            <span className="text-[9px] font-semibold uppercase tracking-wide">More</span>
          </button>
        )}
      </nav>

      {/* ── Mobile "more" sheet ─────────────────────────── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full bg-sw-card border-t border-sw-border rounded-t-2xl p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] max-h-[80vh] overflow-auto">
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
                    <span className="text-xl">{n.icon}</span>
                    <span className="text-[10px] font-semibold text-center leading-tight">{n.label}</span>
                  </button>
                );
              })}
              <button onClick={() => { setMoreOpen(false); signOut(); }}
                className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border text-sw-red border-sw-red/20 bg-sw-redD min-h-[72px]">
                <span className="text-xl">⏻</span>
                <span className="text-[10px] font-semibold">Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
