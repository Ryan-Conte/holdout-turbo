'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPending && session?.user) router.replace('/play');
  }, [session, isPending, router]);

  // surface Steam callback failures (?steam_error=…)
  useEffect(() => {
    const msg = new URLSearchParams(window.location.search).get('steam_error');
    if (msg) setError(msg);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
          setError('Callsign must be 3-16 characters');
          return;
        }
        const res = await authClient.signUp.email({ email, password, name: username });
        if (res.error) {
          setError(res.error.message ?? 'Registration failed');
          return;
        }
      } else {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? 'Login failed');
          return;
        }
      }
      router.push('/play');
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div style={{ textAlign: 'center' }}>
        <div className="logo">HOLDOUT</div>
        <div className="tagline">SCAVENGE · CRAFT · TRADE · SURVIVE</div>
      </div>
      <div className="auth-card">
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>LOG IN</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>ENLIST</button>
        </div>
        <form onSubmit={submit}>
          <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          {mode === 'register' && (
            <input placeholder="Callsign (shown in game)" value={username} onChange={(e) => setUsername(e.target.value)} />
          )}
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="auth-error">{error}</div>
          <button className="btn-primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'DEPLOY' : 'CREATE ACCOUNT'}
          </button>
        </form>
        <div className="auth-divider">— or —</div>
        <a className="btn-steam" href="/api/auth/steam">
          <span className="steam-mark">◉</span> SIGN IN WITH STEAM
        </a>
      </div>
      <div className="auth-hint">
        You wake up in the zone with nothing but your fists.<br />
        Punch trees. Craft a spear. Find the outpost. Don&apos;t trust anyone.
      </div>
    </div>
  );
}
