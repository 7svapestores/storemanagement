'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
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

        // Fetch profile
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) console.error('Profile fetch error:', profileError);

        if (mounted) {
          if (profileData) {
            setProfile(profileData);
          } else {
            console.warn('Profile not found for user, using fallback');
            setProfile({
              id: user.id,
              name: user.email,
              role: 'owner',
              store_id: null,
              username: user.email ? user.email.split('@')[0] : 'user',
            });
          }
          setLoading(false);
        }
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
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();
          if (!mounted) return;
          setProfile(data || {
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
    setUser(null);
    setProfile(null);
    window.location.href = '/login';
  };

  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, isOwner, isEmployee, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
