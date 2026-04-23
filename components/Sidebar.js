'use client';
import { useAuth } from './AuthProvider';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';
import {
  LayoutDashboard, TrendingUp, DollarSign, Coins, ShoppingCart, FileText,
  Receipt, BarChart3, GitCompare, Activity, Download, Package, Users, Shield,
  Mail, Zap, Bot, RefreshCw, Settings, LogOut, Power, MoreHorizontal,
} from 'lucide-react';

const ICON_SIZE = 16;
const ICON_STROKE = 1.5;

export default function Sidebar({ selectedStore, onStoreChange }) {
  const { profile, signOut, isOwner, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    supabase.from('stores').select('*').order('created_at').then(({ data }) => setStores(data || []));
  }, []);

  // Grouped nav for desktop sidebar. Icon is a Lucide component.
  const ownerGroups = [
    {
      label: 'Overview',
      items: [
        { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { path: '/trends',    icon: TrendingUp,      label: 'Trends' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { path: '/sales',     icon: DollarSign,   label: 'Daily Sales' },
        { path: '/cash',      icon: Coins,        label: 'Cash Collection' },
        { path: '/purchases', icon: ShoppingCart, label: 'Product Buying' },
        { path: '/invoices',  icon: FileText,     label: 'Invoices' },
        { path: '/expenses',  icon: Receipt,      label: 'Expenses' },
      ],
    },
    {
      label: 'Reports',
      items: [
        { path: '/reports',  icon: BarChart3,  label: 'P&L Report' },
        { path: '/compare',  icon: GitCompare, label: 'Compare Stores' },
        { path: '/activity', icon: Activity,   label: 'Activity Log' },
        { path: '/exports',  icon: Download,   label: 'Export Data' },
      ],
    },
    {
      label: 'Management',
      items: [
        { path: '/inventory',         icon: Package, label: 'Inventory' },
        { path: '/employee-tracking', icon: Users,   label: 'Employee Tracking' },
        { path: '/team',              icon: Shield,  label: 'Admin' },
        { path: '/email',             icon: Mail,    label: 'Email Reports' },
      ],
    },
    {
      label: 'Agent',
      items: [
        { path: '/nrs-backfill',      icon: Zap,     label: 'NRS Backfill' },
        { path: '/nrs-sync-history',  icon: Bot,     label: '7S Agent Logs' },
        { path: '/cron-setup',        icon: RefreshCw, label: '7S Agent Setup' },
        { path: '/settings',          icon: Settings, label: 'Settings' },
      ],
    },
  ];
  const employeeGroups = [{
    label: 'Work',
    items: [
      { path: '/sales',     icon: DollarSign, label: 'Enter Sales' },
      { path: '/inventory', icon: Package,    label: 'Inventory' },
    ],
  }];
  const groups = isOwner ? ownerGroups : employeeGroups;
  const nav = groups.flatMap(g => g.items);

  // Bottom nav shows 4 primary items + More (owner only); employees just get their single item.
  const primaryPaths = ['/dashboard', '/sales', '/cash', '/inventory'];
  const primary = isOwner ? nav.filter(n => primaryPaths.includes(n.path)) : nav;
  const overflow = isOwner ? nav.filter(n => !primaryPaths.includes(n.path)) : [];

  const storeName = stores.find(s => s.id === profile?.store_id)?.name;

  const go = (path) => { setMoreOpen(false); router.push(path); };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <div className="hidden md:flex fixed left-0 top-0 w-[210px] h-screen z-40 bg-sw-card border-r border-sw-border flex-col overflow-y-auto">
        {/* Logo */}
        <div className="p-3.5 border-b border-sw-border flex items-center gap-2">
          <span className="text-lg">💨</span>
          <span className="text-[16px] font-extrabold tracking-tight">
            <span className="neon-green">7&apos;s</span>{' '}
            <span className="text-sw-text">VAPE</span>{' '}
            <span className="neon-pink">L♥VE</span>
          </span>
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

        {/* Nav — grouped with section labels, Lucide icons, active accent bar */}
        <nav className="p-1.5 flex-1">
          {groups.map(group => (
            <div key={group.label} className="mb-3">
              <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                {group.label}
              </div>
              {group.items.map(n => {
                const active = pathname === n.path;
                const Icon = n.icon;
                return (
                  <button
                    key={n.path}
                    onClick={() => router.push(n.path)}
                    className="w-full relative flex items-center gap-2 py-[7px] pl-3 pr-2 mb-px rounded-md text-[12px] text-left transition-colors"
                    style={{
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: active ? 'var(--bg-hover)' : 'transparent',
                    }}
                    aria-label={n.label}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute left-0 top-1 bottom-1 rounded-r" style={{ width: 2, background: 'var(--color-success)' }} />
                    )}
                    <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} className="flex-shrink-0" />
                    <span className="truncate">{n.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="p-2 border-t border-sw-border">
          <div className="flex items-center gap-1.5 p-1.5 mb-1.5">
            <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-[11px] font-bold
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
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] font-semibold bg-sw-redD text-sw-red border border-sw-red/30 hover:bg-sw-red/20 transition-colors"
            aria-label="Sign out"
          >
            <LogOut size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            Sign Out
          </button>
        </div>
      </div>

      {/* ── Mobile top bar (logo + store selector) ─────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sw-card border-b border-sw-border flex items-center gap-2 px-3"
        style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(48px + env(safe-area-inset-top))' }}
      >
        <span className="text-lg">💨</span>
        <span className="text-[14px] font-extrabold tracking-tight">
          <span className="neon-green">7&apos;s</span>{' '}
          <span className="text-sw-text">VAPE</span>{' '}
          <span className="neon-pink">L♥VE</span>
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
          const Icon = n.icon;
          return (
            <button key={n.path} onClick={() => go(n.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px]
                ${active ? 'text-sw-blue' : 'text-sw-sub'}`}
              aria-label={n.label}>
              <Icon size={20} strokeWidth={ICON_STROKE} />
              <span className="text-[9px] font-semibold uppercase tracking-wide">{n.label.split(' ')[0]}</span>
            </button>
          );
        })}
        {overflow.length > 0 && (
          <button onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-sw-sub"
            aria-label="More options">
            <MoreHorizontal size={20} strokeWidth={ICON_STROKE} />
            <span className="text-[9px] font-semibold uppercase tracking-wide">More</span>
          </button>
        )}
        {/* Employees have no overflow menu — give them a direct Sign Out tab. */}
        {!isOwner && (
          <button onClick={signOut}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-sw-red"
            aria-label="Sign out">
            <Power size={20} strokeWidth={ICON_STROKE} />
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
                const Icon = n.icon;
                return (
                  <button key={n.path} onClick={() => go(n.path)}
                    className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border min-h-[72px]
                      ${active ? 'bg-sw-blueD text-sw-blue border-sw-blue/20' : 'text-sw-sub border-sw-border bg-sw-card2'}`}
                    aria-label={n.label}>
                    <Icon size={22} strokeWidth={ICON_STROKE} />
                    <span className="text-[10px] font-semibold text-center leading-tight">{n.label}</span>
                  </button>
                );
              })}
              <button onClick={() => { setMoreOpen(false); signOut(); }}
                className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border text-sw-red border-sw-red/20 bg-sw-redD min-h-[72px]"
                aria-label="Logout">
                <Power size={22} strokeWidth={ICON_STROKE} />
                <span className="text-[10px] font-semibold">Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
