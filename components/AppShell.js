'use client';
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Sidebar from '@/components/Sidebar';
import { Loading } from '@/components/UI';

export default function AppShell({ children }) {
  const { loading, profile, isOwner, isEmployee } = useAuth();
  const [selectedStore, setSelectedStore] = useState(null);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-sw-bg">
      <div className="text-center">
        <div className="text-5xl mb-4">📊</div>
        <div className="text-sw-blue text-lg font-bold">Loading StoreWise...</div>
      </div>
    </div>
  );

  if (!profile) return <Loading text="Loading profile..." />;

  // For employees, force their store
  const effectiveStore = isEmployee ? profile.store_id : selectedStore;

  return (
    <div className="flex min-h-screen bg-sw-bg">
      <Sidebar selectedStore={effectiveStore} onStoreChange={setSelectedStore} />
      <main className="flex-1 p-5 overflow-y-auto min-h-screen">
        {typeof children === 'function' ? children({ selectedStore: effectiveStore, setSelectedStore }) : children}
      </main>
    </div>
  );
}
