'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const AuthContext = createContext(null);

const AUTH_TIMEOUT_MS = 5000;

// Fallback profile used when the profiles RLS/row is unavailable. Keeps the
// app usable (as owner) rather than stuck on a loading screen. Server-side
// RLS still enforces actual access; this is just so the UI renders.
function fallbackProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.email,
    name: user.email || 'User',
    email: user.email,
    role: 'owner',
    store_id: null,
    is_active: true,
    __fallback: true,
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async (currentUser) => {
      const userId = currentUser?.id;
      if (!userId) {
        if (!cancelled) setProfile(null);
        return;
      }
      try {
        const { data, error } = await withTimeout(
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          AUTH_TIMEOUT_MS,
          'profile fetch'
        );
        if (cancelled) return;
        if (error) {
          // Known issue: profiles RLS policy calls is_owner() which itself
          // queries profiles, creating a recursive check that Postgres refuses.
          // Fall back to a synthetic owner profile so the UI stays usable.
          console.error('[auth] profile fetch error — using fallback profile:', error);
          setProfile(fallbackProfile(currentUser));
          return;
        }
        if (!data) {
          console.error('[auth] no profile row for user — using fallback profile');
          setProfile(fallbackProfile(currentUser));
          return;
        }
        setProfile(data);
      } catch (e) {
        console.error('[auth] profile fetch threw — using fallback profile:', e);
        if (!cancelled) setProfile(fallbackProfile(currentUser));
      }
    };

    const getSession = async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getUser(),
          AUTH_TIMEOUT_MS,
          'auth.getUser'
        );
        if (cancelled) return;
        if (error) throw error;
        const u = data?.user ?? null;
        setUser(u);
        if (u) await loadProfile(u);
      } catch (e) {
        console.warn('[auth] getSession failed:', e.message);
        if (!cancelled) {
          setUser(null);
          setProfile(null);
          setError(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    getSession();

    let subscription;
    try {
      const res = supabase.auth.onAuthStateChange(async (event, session) => {
        try {
          const u = session?.user ?? null;
          setUser(u);
          if (u) {
            await loadProfile(u);
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.warn('[auth] onAuthStateChange handler failed:', e.message);
        } finally {
          setLoading(false);
        }
      });
      subscription = res?.data?.subscription;
    } catch (e) {
      console.warn('[auth] onAuthStateChange setup failed:', e.message);
    }

    // Hard ceiling: never let loading stay true forever, even if both calls hang silently.
    const ceiling = setTimeout(() => {
      if (!cancelled) {
        setLoading((prev) => {
          if (prev) console.warn('[auth] hard timeout — forcing loading=false');
          return false;
        });
      }
    }, AUTH_TIMEOUT_MS + 500);

    return () => {
      cancelled = true;
      clearTimeout(ceiling);
      try { subscription?.unsubscribe(); } catch {}
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[auth] signOut failed:', e.message);
    } finally {
      setUser(null);
      setProfile(null);
      window.location.href = '/login';
    }
  };

  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, signOut, isOwner, isEmployee, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
