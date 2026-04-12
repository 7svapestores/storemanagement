'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Sidebar from '@/components/Sidebar';

export default function AppShell({ children }) {
  const { loading, profile, user, selectedStore, setSelectedStore, effectiveStoreId } = useAuth();
  const router = useRouter();

  // If auth resolved but we have no user, bounce to login immediately.
  useEffect(() => {
    if (!loading && !user) {
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
  }, [loading, user]);

  // Employees have a limited whitelist of pages. If they land outside it, bounce to /sales.
  useEffect(() => {
    if (!loading && profile && profile.role === 'employee') {
      if (typeof window === 'undefined') return;
      const allowed = ['/sales', '/inventory'];
      const path = window.location.pathname;
      if (!allowed.some(p => path === p || path.startsWith(p + '/'))) {
        router.replace('/sales');
      }
    }
  }, [loading, profile, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sw-bg p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🏪</div>
          <div className="text-sw-blue text-lg font-bold">Loading 7S Stores...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sw-bg p-6">
        <div className="text-center">
          <div className="text-sw-sub text-sm mb-3">Redirecting to login...</div>
          <a href="/login" className="text-sw-blue text-sm underline">Click here if not redirected</a>
        </div>
      </div>
    );
  }

  const showProfileWarning = !profile || profile.__fallback;

  return (
    <div className="md:flex min-h-screen bg-sw-bg items-start">
      <Sidebar selectedStore={effectiveStoreId} onStoreChange={setSelectedStore} />
      <main className="flex-1 min-w-0 max-w-full p-3 md:p-5 pt-[60px] md:pt-5 pb-[80px] md:pb-5 min-h-screen">
        {showProfileWarning && (
          <div className="mb-3 rounded-lg border border-sw-amber/30 bg-sw-amberD text-sw-amber px-3 py-2 text-[12px]">
            ⚠️ Profile data unavailable — some permissions may be incorrect. Try signing out and back in, or contact an owner.
          </div>
        )}
        {typeof children === 'function' ? children({ selectedStore: effectiveStoreId, setSelectedStore }) : children}
      </main>
    </div>
  );
}
