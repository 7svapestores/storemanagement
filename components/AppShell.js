'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import Sidebar from '@/components/Sidebar';

export default function AppShell({ children }) {
  const { loading, profile, user, isEmployee } = useAuth();
  const [selectedStore, setSelectedStore] = useState(null);
  const router = useRouter();

  // If auth resolved but we have no user, bounce to login immediately.
  useEffect(() => {
    if (!loading && !user) {
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
  }, [loading, user]);

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

  // User is signed in but profile row missing — show a recoverable error.
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sw-bg p-6">
        <div className="max-w-sm text-center bg-sw-card border border-sw-border rounded-2xl p-6">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-sw-text text-base font-bold mb-2">Profile not found</div>
          <p className="text-sw-sub text-xs mb-4">
            Your account exists but has no profile row. Ask an owner to create one, or sign out and try again.
          </p>
          <a href="/login" onClick={(e) => { e.preventDefault(); router.push('/login'); }}
            className="inline-block px-4 py-2 rounded-lg bg-sw-blueD text-sw-blue text-sm font-semibold border border-sw-blue/20">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  const effectiveStore = isEmployee ? profile.store_id : selectedStore;

  return (
    <div className="md:flex min-h-screen bg-sw-bg">
      <Sidebar selectedStore={effectiveStore} onStoreChange={setSelectedStore} />
      <main className="flex-1 p-3 md:p-5 pt-[60px] md:pt-5 pb-[80px] md:pb-5 overflow-y-auto min-h-screen">
        {typeof children === 'function' ? children({ selectedStore: effectiveStore, setSelectedStore }) : children}
      </main>
    </div>
  );
}
