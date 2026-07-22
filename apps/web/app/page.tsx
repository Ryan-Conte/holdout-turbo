'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_CHARACTER_APPEARANCE } from '@holdout/shared';
import { SurvivorPortrait } from '@/components/SurvivorPortrait';
import { authClient } from '@/lib/auth-client';

interface GameServerEntry { id: number; name: string; region: string; url: string }
type Pings = Record<number, number | 'timeout' | undefined>;
const PING_TIMEOUT_MS = 4_000;

interface RelayPickerProps {
  id: string;
  label: string;
  servers: GameServerEntry[];
  selectedUrl: string;
  pings: Pings;
  onPick: (url: string) => void;
  onRescan: () => void;
}

function pingTone(ping: number | 'timeout' | undefined) {
  if (ping === undefined) return 'measuring';
  if (ping === 'timeout') return 'bad';
  return ping < 60 ? 'good' : ping < 130 ? 'ok' : 'bad';
}

function ServerPing({ value }: { value: number | 'timeout' | undefined }) {
  if (value === undefined) return <span className="ping measuring">SCANNING</span>;
  if (value === 'timeout') return <span className="ping bad">OFFLINE</span>;
  return <span className={`ping ${pingTone(value)}`}>{value} ms</span>;
}

function RelayPicker({ id, label, servers, selectedUrl, pings, onPick, onRescan }: RelayPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = servers.find((server) => server.url === selectedUrl) ?? servers[0];
  const selectedPing = selected ? pings[selected.id] : undefined;
  const onlineCount = servers.filter((server) => typeof pings[server.id] === 'number').length;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleServers = normalizedQuery
    ? servers.filter((server) => `${server.name} ${server.region}`.toLowerCase().includes(normalizedQuery))
    : servers;
  const optionsId = `${id}-options`;

  const pick = (url: string) => {
    onPick(url);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={`relay-picker${open ? ' open' : ''}`}>
      <div className="srv-head">
        <span>{label}</span>
        <div className="srv-actions">
          <small>{servers.length > 0 ? `${onlineCount}/${servers.length} ONLINE` : 'NO RELAYS'}</small>
          <button type="button" className="srv-refresh" onClick={onRescan}>RESCAN</button>
        </div>
      </div>
      <button
        type="button"
        className="relay-current"
        disabled={!selected}
        aria-expanded={open}
        aria-controls={optionsId}
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            <i className={`relay-signal ${pingTone(selectedPing)}`} aria-hidden="true" />
            <span className="relay-current-copy">
              <b>{selected.name}</b>
              <small>{selected.region}</small>
            </span>
            <ServerPing value={selectedPing} />
            <i className="relay-chevron" aria-hidden="true" />
          </>
        ) : (
          <span className="relay-current-copy"><b>NO RELAY AVAILABLE</b><small>Rescan the field network</small></span>
        )}
      </button>
      {open && selected && (
        <div className="relay-drawer" id={optionsId}>
          {servers.length > 4 && (
            <input
              className="relay-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="FILTER NAME OR REGION"
              aria-label="Filter game relays"
              autoFocus
            />
          )}
          <div className="relay-options" role="listbox" aria-label={label}>
            {visibleServers.map((server) => (
              <button
                type="button"
                role="option"
                aria-selected={server.url === selectedUrl}
                className={`relay-option${server.url === selectedUrl ? ' active' : ''}`}
                key={server.id}
                onClick={() => pick(server.url)}
              >
                <i className={`relay-signal ${pingTone(pings[server.id])}`} aria-hidden="true" />
                <span><b>{server.name}</b><small>{server.region}</small></span>
                <ServerPing value={pings[server.id]} />
              </button>
            ))}
            {visibleServers.length === 0 && <div className="relay-no-results">NO MATCHING RELAYS</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const FIELD_NOTES = [
  { code: '01', title: 'SCAVENGE', desc: 'Enter the zone and search for weapons, resources, and valuable gear.' },
  { code: '02', title: 'BUILD', desc: 'Bring supplies home and turn your hideout into a fortified base.' },
  { code: '03', title: 'EXTRACT', desc: 'Reach an extraction beacon alive—or lose everything you carried.' },
];

export default function LandingPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [accessMode, setAccessMode] = useState<'account' | 'guest'>('account');
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

  useEffect(() => {
    if (!session?.user) {
      setIsAdmin(false);
      return;
    }
    void fetch('/api/admin/me').then((res) => setIsAdmin(res.ok)).catch(() => setIsAdmin(false));
  }, [session?.user.id]);

  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get('steam_error');
    if (message) setError(message);
  }, []);

  const measurePings = useCallback(async (list: GameServerEntry[]) => {
    const measurements = await Promise.all(list.map(async (server) => {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      try {
        const res = await fetch(`${server.url}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Server unavailable');
        const milliseconds = Math.max(1, Math.round(performance.now() - startedAt));
        return { server, ping: milliseconds } as const;
      } catch {
        return { server, ping: 'timeout' } as const;
      } finally {
        window.clearTimeout(timeout);
      }
    }));

    const measuredPings = Object.fromEntries(
      measurements.map(({ server, ping }) => [server.id, ping]),
    ) as Pings;
    setPings(measuredPings);

    const fastest = measurements.reduce<(typeof measurements)[number] | undefined>(
      (best, measurement) => {
        if (typeof measurement.ping !== 'number') return best;
        return !best || typeof best.ping !== 'number' || measurement.ping < best.ping
          ? measurement
          : best;
      },
      undefined,
    );
    if (fastest) {
      setServerUrl(fastest.server.url);
      localStorage.setItem('holdout_server_url', fastest.server.url);
    }
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
    setDeploying(true);
    router.push('/play');
  };

  const deployGuest = () => {
    if (!serverUrl) return;
    setDeploying(true);
    router.push(`/play?guest=1&server=${encodeURIComponent(serverUrl)}`);
  };

  const selectedServer = servers.find((server) => server.url === serverUrl);
  const availableServers = servers.filter((server) => typeof pings[server.id] === 'number').length;

  return (
    <div className="home-shell" id="top">
      <header className="home-topbar">
        <a className="home-brand" href="#top" aria-label="Holdout home">
          <span className="home-brand-mark">H</span>
          <span><b>HOLDOUT</b><small>SURVIVAL EXTRACTION</small></span>
        </a>
        <div className="home-topbar-status">
          <span className="home-build-tag">EARLY ACCESS</span>
          <div className="home-network">
            <span className={`home-network-dot${availableServers > 0 ? ' online' : ''}`} />
            <span>{servers.length === 0 ? 'SEARCHING FOR RELAYS' : `${availableServers}/${servers.length} RELAYS ONLINE`}</span>
          </div>
        </div>
      </header>

      <main className="home-layout">
        <section className="home-briefing">
          <div className="home-kicker"><span>ONLINE SURVIVAL EXTRACTION</span><b>SECTOR 07 IS LIVE</b></div>
          <h1>BUILD YOUR HOLDOUT.<br /><em>SURVIVE THE ZONE.</em></h1>
          <p className="home-lede">
            Enter a hostile shared world, take what you can carry, and get out alive.
            Every successful raid makes your home stronger. Every death costs you the gear on your back.
          </p>

          <div className="home-pill-row" aria-label="Game features">
            <span>PERSISTENT BASE</span>
            <span>OPEN-WORLD PVP</span>
            <span>SOLO OR CLAN</span>
          </div>

          <div className="home-raid-loop">
            <div className="home-raid-loop-head">
              <div><span>HOW A RAID WORKS</span><b>YOUR NEXT RUN</b></div>
              <small>ONE LIFE · ONE LOADOUT</small>
            </div>
            <div className="home-field-notes">
              {FIELD_NOTES.map((note) => (
                <article key={note.code}>
                  <span>{note.code}</span>
                  <div><b>{note.title}</b><p>{note.desc}</p></div>
                </article>
              ))}
            </div>
          </div>

          <div className="home-risk-strip">
            <span aria-hidden="true">!</span>
            <div>
              <b>EVERYTHING CARRIED IS AT RISK</b>
              <p>Your hideout is safe. The world outside it is not.</p>
            </div>
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
                  <div className="home-portrait"><SurvivorPortrait appearance={DEFAULT_CHARACTER_APPEARANCE} label={`${session.user.name} survivor`} /></div>
                  <div><span>OPERATOR ONLINE</span><b>{session.user.name}</b><small>Clearance verified</small></div>
                </div>
                <RelayPicker
                  id="operator-relay"
                  label="SELECT RELAY"
                  servers={servers}
                  selectedUrl={serverUrl}
                  pings={pings}
                  onPick={pickServer}
                  onRescan={() => { setPings({}); void measurePings(servers); }}
                />
                <button className="btn-primary deploy-btn" disabled={deploying || !serverUrl || pings[selectedServer?.id ?? -1] === 'timeout'} onClick={deploy}>
                  <span>{deploying ? 'OPENING CHANNEL...' : 'ENTER HIDEOUT'}</span>
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
                  <span>DEPLOYMENT OPTIONS</span>
                  <h2>CHOOSE HOW TO PLAY</h2>
                  <p>Continue your survivor or jump straight into a temporary guest raid.</p>
                </div>
                <div className="home-access-modes" role="tablist" aria-label="Deployment type">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={accessMode === 'account'}
                    aria-controls="account-access"
                    className={accessMode === 'account' ? 'active' : ''}
                    onClick={() => { setAccessMode('account'); setError(''); }}
                  >
                    <span>ACCOUNT</span>
                    <small>Save your progress</small>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={accessMode === 'guest'}
                    aria-controls="guest-access"
                    className={accessMode === 'guest' ? 'active' : ''}
                    onClick={() => { setAccessMode('guest'); setError(''); }}
                  >
                    <span>GUEST RAID</span>
                    <small>Play immediately</small>
                  </button>
                </div>

                {accessMode === 'account' ? (
                  <div className="home-access-panel" id="account-access" role="tabpanel">
                    <div className="home-access-panel-head">
                      <b>ACCOUNT ACCESS</b>
                      <span>Persistent survivor</span>
                    </div>
                    <div className="auth-tabs">
                      <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>LOG IN</button>
                      <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>CREATE ACCOUNT</button>
                    </div>
                    <form onSubmit={submit}>
                      <label><span>EMAIL</span><input placeholder="operator@holdout" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                      {mode === 'register' && (
                        <label><span>CALLSIGN</span><input placeholder="Shown in game" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                      )}
                      <label><span>PASSWORD</span><input placeholder="Minimum 8 characters" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                      {error && <div className="auth-error">{error}</div>}
                      <button className="btn-primary" disabled={busy}>{busy ? 'AUTHENTICATING...' : mode === 'login' ? 'LOG IN & CONTINUE' : 'CREATE SURVIVOR'}</button>
                    </form>
                    <div className="auth-divider"><span>OR CONTINUE WITH</span></div>
                    <a className="btn-steam" href="/api/auth/steam"><span className="steam-mark">S</span> STEAM</a>
                  </div>
                ) : (
                  <div className="home-access-panel home-guest-panel" id="guest-access" role="tabpanel">
                    <div className="home-access-panel-head">
                      <b>GUEST DEPLOYMENT</b>
                      <span>Temporary raid</span>
                    </div>
                    <p className="home-guest-lede">Choose a relay and enter the main world immediately with empty hands.</p>
                    <div className="home-guest-notice">
                      <b>GUEST LIMITS</b>
                      <p>No saved progress, extraction, chat, friends, clans, or community features.</p>
                    </div>
                    <div className="guest-relay-picker">
                      <RelayPicker
                        id="guest-relay"
                        label="CHOOSE RELAY"
                        servers={servers}
                        selectedUrl={serverUrl}
                        pings={pings}
                        onPick={pickServer}
                        onRescan={() => { setPings({}); void measurePings(servers); }}
                      />
                    </div>
                    <button
                      className="btn-guest"
                      disabled={deploying || !serverUrl || pings[selectedServer?.id ?? -1] === 'timeout'}
                      onClick={deployGuest}
                    >
                      <span>{deploying ? 'OPENING GUEST CHANNEL...' : 'DEPLOY AS GUEST'}</span>
                      <small>Start a temporary raid now</small>
                      <b>{selectedServer?.region ?? 'SELECTING RELAY'}</b>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="home-console-foot"><span>ENCRYPTED LINK</span><b>BUILD 0.7.4</b></div>
        </aside>
      </main>

      <footer className="home-footer">
        <span>HOLDOUT FIELD NETWORK · BUILD 0.7.4</span>
        <p>Scavenge. Build. Fight. Extract.</p>
        <span>THE ZONE KEEPS WHAT YOU LOSE</span>
      </footer>
    </div>
  );
}
