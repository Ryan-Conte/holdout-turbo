'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_CHARACTER_APPEARANCE, sanitizeCharacterAppearance, type CharacterAppearance } from '@holdout/shared';
import { CharacterCreator } from '@/components/CharacterCreator';
import { authClient } from '@/lib/auth-client';

interface GameServerEntry { id: number; name: string; region: string; url: string }
type Pings = Record<number, number | 'timeout' | undefined>;

const FIELD_NOTES = [
  { code: '01', title: 'SCAVENGE', desc: 'Push deeper into the zone for weapons, ore, and prototype hardware.' },
  { code: '02', title: 'FORTIFY', desc: 'Turn a bare hideout into a working base with storage, fire, and steel.' },
  { code: '03', title: 'EXTRACT', desc: 'Reach a beacon alive. Anything left on your body belongs to the zone.' },
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [landingView, setLandingView] = useState<'deploy' | 'character'>('deploy');
  const [appearance, setAppearance] = useState<CharacterAppearance>(DEFAULT_CHARACTER_APPEARANCE);
  const [appearanceConfigured, setAppearanceConfigured] = useState(false);
  const [appearanceLoading, setAppearanceLoading] = useState(true);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [appearanceError, setAppearanceError] = useState('');

  useEffect(() => {
    if (!session?.user) {
      setIsAdmin(false);
      return;
    }
    void fetch('/api/admin/me').then((res) => setIsAdmin(res.ok)).catch(() => setIsAdmin(false));
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user) {
      setAppearance(DEFAULT_CHARACTER_APPEARANCE);
      setAppearanceConfigured(false);
      setAppearanceLoading(isPending);
      setLandingView('deploy');
      return;
    }
    let cancelled = false;
    setAppearanceLoading(true);
    void fetch('/api/profile/appearance', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load survivor profile');
        const data = await res.json() as { appearance?: unknown; configured?: boolean };
        if (cancelled) return;
        setAppearance(sanitizeCharacterAppearance(data.appearance));
        setAppearanceConfigured(Boolean(data.configured));
      })
      .catch(() => {
        if (!cancelled) setAppearanceError('Could not load your survivor. You can still configure a new profile.');
      })
      .finally(() => { if (!cancelled) setAppearanceLoading(false); });
    return () => { cancelled = true; };
  }, [isPending, session?.user.id]);

  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get('steam_error');
    if (message) setError(message);
  }, []);

  const measurePings = useCallback(async (list: GameServerEntry[]) => {
    await Promise.all(list.map(async (server) => {
      const startedAt = performance.now();
      try {
        const res = await fetch(`${server.url}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Server unavailable');
        const milliseconds = Math.max(1, Math.round(performance.now() - startedAt));
        setPings((current) => ({ ...current, [server.id]: milliseconds }));
      } catch {
        setPings((current) => ({ ...current, [server.id]: 'timeout' }));
      }
    }));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/servers');
        if (!res.ok) return;
        const list: GameServerEntry[] = (await res.json()).servers ?? [];
        setServers(list);
        const saved = localStorage.getItem('holdout_server_url');
        const selected = list.find((server) => server.url === saved) ?? list[0];
        if (selected) {
          setServerUrl(selected.url);
          localStorage.setItem('holdout_server_url', selected.url);
        }
        void measurePings(list);
      } catch {
        // Development without a database still renders the briefing.
      }
    })();
  }, [measurePings]);

  const pickServer = (url: string) => {
    setServerUrl(url);
    localStorage.setItem('holdout_server_url', url);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(username)) {
          setError('Callsign must be 3-16 characters');
          return;
        }
        const result = await authClient.signUp.email({ email, password, name: username });
        if (result.error) {
          setError(result.error.message ?? 'Registration failed');
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setError(result.error.message ?? 'Login failed');
          return;
        }
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  const deploy = () => {
    if (!appearanceConfigured) {
      setAppearanceError('');
      setLandingView('character');
      return;
    }
    setDeploying(true);
    router.push('/play');
  };

  const saveAppearance = async () => {
    setAppearanceSaving(true);
    setAppearanceError('');
    try {
      const res = await fetch('/api/profile/appearance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appearance }),
      });
      if (!res.ok) throw new Error('Could not save profile');
      const data = await res.json() as { appearance?: unknown };
      setAppearance(sanitizeCharacterAppearance(data.appearance));
      setAppearanceConfigured(true);
      setLandingView('deploy');
    } catch {
      setAppearanceError('The survivor profile could not be saved. Please try again.');
    } finally {
      setAppearanceSaving(false);
    }
  };

  const pingBadge = (id: number) => {
    const ping = pings[id];
    if (ping === undefined) return <span className="ping measuring">SCANNING</span>;
    if (ping === 'timeout') return <span className="ping bad">OFFLINE</span>;
    return <span className={`ping ${ping < 60 ? 'good' : ping < 130 ? 'ok' : 'bad'}`}>{ping} ms</span>;
  };

  const selectedServer = servers.find((server) => server.url === serverUrl);
  const availableServers = servers.filter((server) => typeof pings[server.id] === 'number').length;

  if (session?.user && landingView === 'character') {
    return (
      <CharacterCreator
        callsign={session.user.name}
        value={appearance}
        saving={appearanceSaving}
        error={appearanceError}
        onChange={setAppearance}
        onCancel={() => setLandingView('deploy')}
        onSave={() => void saveAppearance()}
      />
    );
  }

  return (
    <div className="home-shell" id="top">
      <header className="home-topbar">
        <a className="home-brand" href="#top" aria-label="Holdout home">
          <span className="home-brand-mark">H</span>
          <span><b>HOLDOUT</b><small>EXTRACTION PROTOCOL</small></span>
        </a>
        <div className="home-network">
          <span className={`home-network-dot${availableServers > 0 ? ' online' : ''}`} />
          <span>{servers.length === 0 ? 'SEARCHING FOR RELAYS' : `${availableServers}/${servers.length} RELAYS AVAILABLE`}</span>
        </div>
      </header>

      <main className="home-layout">
        <section className="home-briefing">
          <div className="home-kicker"><span>FIELD BRIEFING</span><b>SECTOR 07</b></div>
          <h1>NOTHING OUT THERE<br />IS <em>YOURS</em> YET.</h1>
          <p className="home-lede">
            Enter empty-handed. Scavenge a living from the ruins, build somewhere worth returning to,
            and make it home before another survivor takes your place.
          </p>

          <div className="home-map" aria-label="Illustrated extraction zone">
            <div className="home-map-grid" />
            <div className="home-route route-one" />
            <div className="home-route route-two" />
            <span className="home-map-label label-outpost">SAFEHOUSE 04</span>
            <span className="home-map-label label-danger">HIGH RISK</span>
            <span className="home-map-label label-extract">EXFIL B</span>
            <div className="home-map-point point-safe"><i /></div>
            <div className="home-map-point point-danger"><i /></div>
            <div className="home-extract-ring"><i /></div>
            <div className="home-sprite survivor" />
            <div className="home-sprite hostile" />
            <div className="home-map-coords">27.4691 N / 82.6417 E<br />SIGNAL DEGRADED</div>
          </div>

          <div className="home-field-notes">
            {FIELD_NOTES.map((note) => (
              <article key={note.code}>
                <span>{note.code}</span>
                <div><b>{note.title}</b><p>{note.desc}</p></div>
              </article>
            ))}
          </div>
        </section>

        <aside className="home-console">
          <div className="home-console-head">
            <div><span>TERMINAL</span><b>{session?.user ? 'DEPLOYMENT' : 'IDENTITY CHECK'}</b></div>
            <small>HX-04</small>
          </div>

          <div className="home-console-body">
            {isPending ? (
              <div className="auth-loading"><div className="spinner" />CHECKING CREDENTIALS</div>
            ) : session?.user ? (
              <>
                <div className="home-operator">
                  <div className="home-portrait"><div className="home-sprite survivor" /></div>
                  <div><span>OPERATOR ONLINE</span><b>{session.user.name}</b><small>Clearance verified</small></div>
                </div>
                <div className="srv-head">
                  <span>SELECT RELAY</span>
                  <button className="srv-refresh" onClick={() => { setPings({}); void measurePings(servers); }}>RESCAN</button>
                </div>
                <div className="srv-list">
                  {servers.map((server) => (
                    <label className={`srv-row${serverUrl === server.url ? ' active' : ''}`} key={server.id}>
                      <input type="radio" name="server" checked={serverUrl === server.url} onChange={() => pickServer(server.url)} />
                      <span className="srv-name">{server.name}</span>
                      <span className="srv-region">{server.region}</span>
                      {pingBadge(server.id)}
                    </label>
                  ))}
                  {servers.length === 0 && <div className="home-empty">NO RELAYS REGISTERED</div>}
                </div>
                <button className="btn-survivor" disabled={appearanceLoading} onClick={() => { setAppearanceError(''); setLandingView('character'); }}>
                  <span><i className={appearanceConfigured ? 'ready' : ''} />{appearanceConfigured ? 'SURVIVOR READY' : 'PROFILE REQUIRED'}</span>
                  <b>{appearanceLoading ? 'LOADING...' : appearanceConfigured ? 'EDIT APPEARANCE' : 'CREATE SURVIVOR'}</b>
                </button>
                {appearanceError && <div className="auth-error">{appearanceError}</div>}
                <button className="btn-primary deploy-btn" disabled={deploying || appearanceLoading || !serverUrl || pings[selectedServer?.id ?? -1] === 'timeout'} onClick={deploy}>
                  <span>{deploying ? 'OPENING CHANNEL...' : appearanceConfigured ? 'DEPLOY TO ZONE' : 'CREATE SURVIVOR TO DEPLOY'}</span>
                  <b>{selectedServer?.region ?? '--'}</b>
                </button>
                <div className="home-console-links">
                  {isAdmin && <button onClick={() => router.push('/admin/map')}>ADMIN ENGINE</button>}
                  <button onClick={() => void authClient.signOut()}>SIGN OUT</button>
                </div>
              </>
            ) : (
              <>
                <div className="home-auth-intro">
                  <span>AUTHORIZED PERSONNEL ONLY</span>
                  <h2>ENTER THE ZONE</h2>
                  <p>Your profile, hideout, and extraction record are tied to this identity.</p>
                </div>
                <div className="auth-tabs">
                  <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>LOG IN</button>
                  <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>ENLIST</button>
                </div>
                <form onSubmit={submit}>
                  <label><span>EMAIL</span><input placeholder="operator@holdout" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  {mode === 'register' && (
                    <label><span>CALLSIGN</span><input placeholder="Shown in game" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                  )}
                  <label><span>PASSWORD</span><input placeholder="Minimum 8 characters" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                  {error && <div className="auth-error">{error}</div>}
                  <button className="btn-primary" disabled={busy}>{busy ? 'AUTHENTICATING...' : mode === 'login' ? 'VERIFY IDENTITY' : 'CREATE OPERATOR'}</button>
                </form>
                <div className="auth-divider"><span>OR USE EXTERNAL ID</span></div>
                <a className="btn-steam" href="/api/auth/steam"><span className="steam-mark">S</span> CONTINUE WITH STEAM</a>
              </>
            )}
          </div>

          <div className="home-console-foot"><span>ENCRYPTED LINK</span><b>BUILD 0.7.4</b></div>
        </aside>
      </main>

      <footer className="home-footer">
        <span>HOLDOUT FIELD NETWORK</span>
        <p>Punch trees. Forge steel. Wall in your camp. Trust carefully. Extract.</p>
        <span>ALL ITEMS AT RISK</span>
      </footer>
    </div>
  );
}
