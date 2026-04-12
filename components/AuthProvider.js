'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fetchProfile, clearProfileCache } from '@/lib/auth-check';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedStore, setSelectedStore] = useState(null); // null = "All Stores"
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    // Force stop loading after 4 seconds no matter what
    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn('Auth timeout - forcing load complete');
        setLoading(false);
      }
    }, 4000);

    const init = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
          if (mounted) { setUser(null); setProfile(null); setLoading(false); }
          return;
        }
        if (mounted) setUser(user);

        // Fetch profile via the /api/profile route (uses service role key,
        // bypasses RLS entirely — can't stall on a bad policy).
        const p = await fetchProfile({ force: true });
        if (!mounted) return;
        if (p) {
          setProfile(p);
        } else {
          console.warn('Profile API returned null — using fallback');
          setProfile({
            id: user.id,
            name: user.email,
            role: 'owner',
            store_id: null,
            username: user.email ? user.email.split('@')[0] : 'user',
          });
        }
        setLoading(false);
      } catch (err) {
        console.error('Auth init error:', err);
        if (mounted) setLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        try {
          const p = await fetchProfile({ force: true });
          if (!mounted) return;
          setProfile(p || {
            id: session.user.id,
            name: session.user.email,
            role: 'owner',
            store_id: null,
            username: session.user.email ? session.user.email.split('@')[0] : 'user',
          });
        } catch (e) {
          console.error('Profile fetch error (authStateChange):', e);
          if (mounted) {
            setProfile({
              id: session.user.id,
              name: session.user.email,
              role: 'owner',
              store_id: null,
              username: session.user.email ? session.user.email.split('@')[0] : 'user',
            });
          }
        } finally {
          if (mounted) setLoading(false);
        }
      } else {
        clearProfileCache();
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      try { subscription.unsubscribe(); } catch {}
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error('signOut error:', e);
    }
    clearProfileCache();
    setUser(null);
    setProfile(null);
    window.location.href = '/login';
  };

  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';

  // Employees are hard-scoped to their assigned store regardless of selector state.
  const effectiveStoreId = isEmployee ? (profile?.store_id || null) : selectedStore;

  return (
    <AuthContext.Provider value={{
      user, profile, loading, signOut,
      isOwner, isEmployee, supabase,
      selectedStore, setSelectedStore, effectiveStoreId,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
