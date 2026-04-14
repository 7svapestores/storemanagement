'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      // Try client router first, then fall back to a hard navigation so we
      // never get stuck on the login form after a successful sign-in.
      try {
        router.push('/dashboard');
        router.refresh();
      } catch {}
      setTimeout(() => {
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/login')) {
          window.location.href = '/dashboard';
        }
      }, 600);
    } catch (err) {
      setError(err?.message || 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: 'radial-gradient(ellipse at 20% 30%, #12221A, #060A10 55%), radial-gradient(ellipse at 80% 80%, #22101A, #060A10 60%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">💨</div>
          <h1 className="text-3xl font-black tracking-tight">
            <span className="neon-green">7&apos;s</span>{' '}
            <span className="text-sw-text">VAPE</span>{' '}
            <span className="neon-pink">L♥VE</span>
          </h1>
          <p className="text-sw-sub text-sm mt-1">Vapor • CBD • Kratom</p>
        </div>

        <form onSubmit={handleLogin} className="bg-sw-card rounded-2xl p-7 border border-sw-border">
          {error && <div className="bg-sw-redD rounded-lg p-2 mb-3 text-sw-red text-xs text-center">{error}</div>}

          <div className="mb-4">
            <label className="block text-sw-sub text-[10px] font-bold uppercase tracking-wider mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@7sstores.com" autoFocus className="w-full" />
          </div>

          <div className="mb-5">
            <label className="block text-sw-sub text-[10px] font-bold uppercase tracking-wider mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-bold cursor-pointer disabled:opacity-60 text-black"
            style={{ background: 'linear-gradient(135deg, #39FF14, #FF1493)', boxShadow: '0 0 22px rgba(57,255,20,0.35)' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
