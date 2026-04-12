'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const AuthContext = createContext(null);

const AUTH_TIMEOUT_MS = 3000;

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

    const loadProfile = async (userId) => {
      try {
        const { data, error } = await withTimeout(
          supabase.from('profiles').select('*').eq('id', userId).single(),
          AUTH_TIMEOUT_MS,
          'profile fetch'
        );
        if (cancelled) return;
        if (error) {
          console.warn('[auth] profile fetch error:', error.message);
          setProfile(null);
        } else {
          setProfile(data);
        }
      } catch (e) {
        console.warn('[auth] profile fetch failed:', e.message);
        if (!cancelled) setProfile(null);
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
        if (u) await loadProfile(u.id);
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
            await loadProfile(u.id);
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
