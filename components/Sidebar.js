'use client';
import { useAuth } from './AuthProvider';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Sidebar({ selectedStore, onStoreChange }) {
  const { profile, signOut, isOwner, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [stores, setStores] = useState([]);

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

  const storeName = stores.find(s => s.id === profile?.store_id)?.name;

  return (
    <div className="w-[210px] min-h-screen bg-sw-card border-r border-sw-border flex flex-col flex-shrink-0 overflow-y-auto">
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
  );
}
