'use client';

// Landing page: hero + briefing, login/enlist/Steam, and — once signed in —
// a deploy console with the server browser (live pings) and a DEPLOY button.

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

interface GameServerEntry { id: number; name: string; region: string; url: string }
type Pings = Record<number, number | 'timeout' | undefined>;

const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: '🏕', title: 'BUILD YOUR BASE', desc: 'Floors, walls, forges and torchlight — carve a home out of the zone, then show it off.' },
  { icon: '💎', title: 'HUNT RARE LOOT', desc: 'Ore veins, black-market valuables, prototype hardware. The hot zones pay best — and bite hardest.' },
  { icon: '⚔', title: 'EXTRACT OR DIE', desc: 'Everything you carry is on the line. Reach a beacon to bank it, or feed the next scavenger.' },
];

export default function LandingPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [servers, setServers] = useState<GameServerEntry[]>([]);
  const [serverUrl, setServerUrl] = useState('');
  const [pings, setPings] = useState<Pings>({});
  const [deploying, setDeploying] = useState(false);

  // surface Steam callback failures (?steam_error=…)
  useEffect(() => {
    const msg = new URLSearchParams(window.location.search).get('steam_error');
    if (msg) setError(msg);
  }, []);

  // server browser + ping sweep
  const measurePings = useCallback(async (list: GameServerEntry[]) => {
    await Promise.all(list.map(async (s) => {
      const t0 = performance.now();
      try {
        const res = await fetch(`${s.url}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('bad');
        const ms = Math.max(1, Math.round(performance.now() - t0));
        setPings((p) => ({ ...p, [s.id]: ms }));
      } catch {
        setPings((p) => ({ ...p, [s.id]: 'timeout' }));
      }
    }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/servers');
        if (!res.ok) return;
        const list: GameServerEntry[] = (await res.json()).servers ?? [];
        setServers(list);
        const saved = localStorage.getItem('holdout_server_url');
        const pick = list.find((s) => s.url === saved) ?? list[0];
        if (pick) {
          setServerUrl(pick.url);
          localStorage.setItem('holdout_server_url', pick.url);
        }
        void measurePings(list);
      } catch { /* dev without DB still renders */ }
    })();
  }, [measurePings]);

  const pickServer = (url: string) => {
    setServerUrl(url);
    localStorage.setItem('holdout_server_url', url);
  };

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
      // no auto-warp: land on the deploy console so you can pick a server
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  const deploy = () => {
    setDeploying(true);
    router.push('/play');
  };

  const pingBadge = (id: number) => {
    const p = pings[id];
    if (p === undefined) return <span className="ping measuring">…</span>;
    if (p === 'timeout') return <span className="ping bad">OFFLINE</span>;
    return <span className={`ping ${p < 60 ? 'good' : p < 130 ? 'ok' : 'bad'}`}>{p} ms</span>;
  };

  return (
    <div className="landing">
      <div className="landing-hero">
        <div className="logo big">HOLDOUT</div>
        <div className="tagline">SCAVENGE · CRAFT · BUILD · EXTRACT</div>
        <p className="hero-blurb">
          A top-down multiplayer extraction shooter. You wake up with nothing but your fists —
          what you do with them is the game.
        </p>
      </div>

      <div className="landing-cols">
        <div className="landing-features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="auth-card">
          {isPending ? (
            <div className="auth-loading">
              <div className="spinner" />
              CHECKING CREDENTIALS…
            </div>
          ) : session?.user ? (
            <>
              <div className="deploy-head">
                <span className="deploy-label">SIGNED IN AS</span>
                <b>{session.user.name}</b>
              </div>
              <div className="srv-head">
                <span>SERVER</span>
                <button className="srv-refresh" onClick={() => { setPings({}); void measurePings(servers); }}>↻ PING</button>
              </div>
              <div className="srv-list">
                {servers.map((s) => (
                  <label className={`srv-row${serverUrl === s.url ? ' active' : ''}`} key={s.id}>
                    <input type="radio" name="server" checked={serverUrl === s.url} onChange={() => pickServer(s.url)} />
                    <span className="srv-name">{s.name}</span>
                    <span className="srv-region">{s.region}</span>
                    {pingBadge(s.id)}
                  </label>
                ))}
                {servers.length === 0 && <div className="auth-hint">No servers registered yet.</div>}
              </div>
              <button className="btn-primary deploy-btn" disabled={deploying || !serverUrl || pings[servers.find((s) => s.url === serverUrl)?.id ?? -1] === 'timeout'} onClick={deploy}>
                {deploying ? 'DEPLOYING…' : '▶ DEPLOY'}
              </button>
              <button className="btn-linkish" onClick={() => authClient.signOut()}>log out</button>
            </>
          ) : (
            <>
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
                  {busy ? '…' : mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}
                </button>
              </form>
              <div className="auth-divider">— or —</div>
              <a className="btn-steam" href="/api/auth/steam">
                <span className="steam-mark">◉</span> SIGN IN WITH STEAM
              </a>
            </>
          )}
        </div>
      </div>

      <div className="auth-hint">
        Punch trees. Forge steel. Wall in your camp. Don&apos;t trust anyone. Extract.
      </div>
    </div>
  );
}
