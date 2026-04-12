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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  };

  const quickLogin = (em, pw) => { setEmail(em); setPassword(pw); };

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: 'radial-gradient(ellipse at 20% 30%, #0D1B2A, #060A10 65%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏪</div>
          <h1 className="text-3xl font-black text-sw-text">7S <span className="text-sw-blue">Stores</span></h1>
          <p className="text-sw-sub text-sm mt-1">Store Management System</p>
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
            style={{ background: 'linear-gradient(135deg, #60A5FA, #93C5FD)' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="mt-4 p-3 bg-sw-card2 rounded-lg border border-sw-border">
            <p className="text-sw-dim text-[10px] font-bold uppercase mb-2">Quick Login</p>
            <button type="button" onClick={() => quickLogin('admin@7sstores.com', 'admin123')}
              className="w-full text-left py-1.5 px-2 rounded text-xs text-sw-sub hover:bg-sw-border/30 font-mono">
              Owner: admin@7sstores.com
            </button>
            <button type="button" onClick={() => quickLogin('bells@7sstores.com', 'emp123')}
              className="w-full text-left py-1.5 px-2 rounded text-xs text-sw-sub hover:bg-sw-border/30 font-mono">
              Employee: bells@7sstores.com
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
