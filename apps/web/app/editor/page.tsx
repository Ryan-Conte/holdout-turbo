'use client';

// Admin panel — map builder (tiles + placements → `maps` table, API loads on boot)
// and quest editor (`quests` table, hot-reloaded by the API within a minute).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthoredMap, ITEMS, MapObject, MapObjectType, Tile } from '@holdout/shared';

interface QuestRow {
  id: number;
  name: string;
  desc: string;
  kind: string;
  target: string;
  count: number;
  rewardMoney: number;
  rewardItem: string | null;
  rewardQty: number;
  requiresId: number | null;
  tier: number;
  active: boolean;
}

const EMPTY_QUEST: QuestRow = {
  id: 0, name: '', desc: '', kind: 'kill', target: 'zombie', count: 5,
  rewardMoney: 50, rewardItem: null, rewardQty: 1, requiresId: null, tier: 1, active: true,
};

function QuestsEditor() {
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [form, setForm] = useState<QuestRow>({ ...EMPTY_QUEST });
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/quests');
    if (res.ok) setQuests((await res.json()).quests ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setStatus('Saving…');
    const res = await fetch('/api/admin/quests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    });
    const data = await res.json();
    setStatus(res.ok ? 'Saved — live in-game within a minute' : `Error: ${data.error}`);
    if (res.ok) {
      setForm({ ...EMPTY_QUEST });
      void load();
    }
  };

  const remove = async (id: number) => {
    await fetch('/api/admin/quests', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void load();
  };

  const itemIds = Object.keys(ITEMS);
  const set = (patch: Partial<QuestRow>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="quests-editor">
      <div className="q-form">
        <h2>{form.id ? `EDIT QUEST #${form.id}` : 'NEW QUEST'}</h2>
        <label className="ed-label">NAME</label>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Cull the horde" />
        <label className="ed-label">DESCRIPTION (optional)</label>
        <input value={form.desc} onChange={(e) => set({ desc: e.target.value })} placeholder="The outpost needs breathing room…" />
        <label className="ed-label">TYPE</label>
        <select value={form.kind} onChange={(e) => set({ kind: e.target.value, target: e.target.value === 'kill' ? 'zombie' : 'wood' })}>
          <option value="kill">Kill enemies</option>
          <option value="fetch">Fetch items</option>
        </select>
        <label className="ed-label">TARGET</label>
        {form.kind === 'kill' ? (
          <select value={form.target} onChange={(e) => set({ target: e.target.value })}>
            <option value="zombie">Zombies</option>
            <option value="military">Military</option>
          </select>
        ) : (
          <select value={form.target} onChange={(e) => set({ target: e.target.value })}>
            {itemIds.map((id) => <option key={id} value={id}>{ITEMS[id as keyof typeof ITEMS].name}</option>)}
          </select>
        )}
        <label className="ed-label">COUNT</label>
        <input type="number" value={form.count} onChange={(e) => set({ count: Number(e.target.value) })} />
        <label className="ed-label">REWARD CREDITS</label>
        <input type="number" value={form.rewardMoney} onChange={(e) => set({ rewardMoney: Number(e.target.value) })} />
        <label className="ed-label">REWARD ITEM (optional)</label>
        <select value={form.rewardItem ?? ''} onChange={(e) => set({ rewardItem: e.target.value || null })}>
          <option value="">— none —</option>
          {itemIds.map((id) => <option key={id} value={id}>{ITEMS[id as keyof typeof ITEMS].name}</option>)}
        </select>
        {form.rewardItem && (
          <>
            <label className="ed-label">REWARD QTY</label>
            <input type="number" value={form.rewardQty} onChange={(e) => set({ rewardQty: Number(e.target.value) })} />
          </>
        )}
        <label className="ed-label">TRADER TIER</label>
        <select value={form.tier} onChange={(e) => set({ tier: Number(e.target.value) })}>
          <option value={1}>1 — Outpost quartermaster</option>
          <option value={2}>2 — Black-market dealer (hot zones)</option>
        </select>
        <label className="ed-label">REQUIRES QUEST (unlock chain)</label>
        <select value={form.requiresId ?? ''} onChange={(e) => set({ requiresId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">— none (always available) —</option>
          {quests.filter((q) => q.id !== form.id).map((q) => <option key={q.id} value={q.id}>#{q.id} {q.name}</option>)}
        </select>
        <label className="ed-label">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> ACTIVE
        </label>
        <button className="btn-primary" onClick={save}>{form.id ? 'UPDATE' : 'CREATE'}</button>
        {form.id !== 0 && <button className="q-cancel" onClick={() => setForm({ ...EMPTY_QUEST })}>NEW INSTEAD</button>}
        <div className="ed-status">{status}</div>
      </div>
      <div className="q-list">
        <h2>QUESTS ({quests.length})</h2>
        {quests.map((q) => (
          <div className="q-row" key={q.id}>
            <div className="q-body">
              <b>#{q.id} {q.name}</b> {!q.active && <span className="q-off">INACTIVE</span>}
              <div className="q-meta">
                T{q.tier} · {q.kind === 'kill' ? `kill ${q.count} ${q.target}` : `fetch ${q.count} ${q.target}`} → {q.rewardMoney}cr
                {q.rewardItem ? ` + ${q.rewardQty}× ${q.rewardItem}` : ''}
                {q.requiresId ? ` · needs #${q.requiresId}` : ''}
              </div>
            </div>
            <button onClick={() => setForm(q)}>EDIT</button>
            <button onClick={() => remove(q.id)}>DELETE</button>
          </div>
        ))}
        {quests.length === 0 && <div className="ed-help">No quests yet — create one on the left. Players see them at any trader.</div>}
      </div>
    </div>
  );
}

interface ServerRow { id: number; name: string; region: string; url: string; active: boolean; sort: number }

/** Server-browser management: register game servers with regions. */
function ServersEditor() {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [form, setForm] = useState({ name: '', region: 'local', url: 'http://localhost:3001' });
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/servers');
    if (res.ok) setServers((await res.json()).servers ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setStatus('Saving…');
    const res = await fetch('/api/admin/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setStatus(res.ok ? 'Server registered' : `Error: ${data.error}`);
    if (res.ok) {
      setForm({ name: '', region: 'local', url: '' });
      void load();
    }
  };

  const toggle = async (s: ServerRow) => {
    await fetch('/api/admin/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, active: !s.active }) });
    void load();
  };

  const remove = async (id: number) => {
    await fetch('/api/admin/servers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void load();
  };

  return (
    <div className="quests-editor">
      <div className="q-form">
        <h2>REGISTER SERVER</h2>
        <label className="ed-label">NAME</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="EU West 1" />
        <label className="ed-label">REGION</label>
        <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="eu-west" />
        <label className="ed-label">SOCKET URL</label>
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://eu1.holdout.gg" />
        <button className="btn-primary" onClick={add}>REGISTER</button>
        <div className="ed-status">{status}</div>
        <div className="ed-help">
          Players pick a server on the login screen. Every server must share the same
          JWT_SECRET and database. &quot;Local&quot; is auto-seeded for dev.
        </div>
      </div>
      <div className="q-list">
        <h2>SERVERS ({servers.length})</h2>
        {servers.map((s) => (
          <div className="q-row" key={s.id}>
            <div className="q-body">
              <b>#{s.id} {s.name}</b> {!s.active && <span className="q-off">HIDDEN</span>}
              <div className="q-meta">{s.region} · {s.url}</div>
            </div>
            <button onClick={() => toggle(s)}>{s.active ? 'HIDE' : 'SHOW'}</button>
            <button onClick={() => remove(s.id)}>DELETE</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const MIN_SIZE = 20;
const MAX_SIZE = 200; // server clamp — keep in sync with /api/admin/map

const TILE_TOOLS: { tile: Tile; label: string; color: string }[] = [
  { tile: Tile.Grass, label: 'Grass', color: '#3f6b38' },
  { tile: Tile.Water, label: 'Water', color: '#33628f' },
  { tile: Tile.Sand, label: 'Sand', color: '#b99e6b' },
  { tile: Tile.Road, label: 'Road', color: '#7a755f' },
  { tile: Tile.Asphalt, label: 'Asphalt', color: '#3f3f45' },
  { tile: Tile.Floor, label: 'Floor', color: '#8a6a48' },
  { tile: Tile.Wall, label: 'Wall', color: '#4c3a28' },
  { tile: Tile.Tree, label: 'Tree', color: '#2a4d2a' },
  { tile: Tile.Rock, label: 'Rock', color: '#77777d' },
  { tile: Tile.CopperOre, label: 'Copper vein', color: '#c87a3a' },
  { tile: Tile.IronOre, label: 'Iron vein', color: '#9aa4b0' },
  { tile: Tile.Cliff, label: 'Cliff', color: '#5a5048' },
];

const OBJECT_TOOLS: { type: MapObjectType; label: string; color: string; letter: string }[] = [
  { type: 'spawn', label: 'Player spawn', color: '#f0d878', letter: 'S' },
  { type: 'chest', label: 'Chest', color: '#c98b3a', letter: 'C' },
  { type: 'chest_military', label: 'Mil. chest', color: '#8fb06a', letter: 'M' },
  { type: 'loot', label: 'Loot spawn', color: '#d8d2b8', letter: 'l' },
  { type: 'zombie', label: 'Zombie', color: '#7fa062', letter: 'Z' },
  { type: 'military', label: 'Military', color: '#c07a4a', letter: 'G' },
  { type: 'deer', label: 'Deer', color: '#c8a878', letter: 'D' },
  { type: 'rabbit', label: 'Rabbit', color: '#b8a88e', letter: 'r' },
  { type: 'boar', label: 'Boar', color: '#5a4a3c', letter: 'B' },
  { type: 'wolf', label: 'Wolf', color: '#6e7076', letter: 'W' },
  { type: 'extract', label: 'Extraction beacon', color: '#5ff08a', letter: 'E' },
  { type: 'trader', label: 'Trader outpost', color: '#78d878', letter: 'T' },
  { type: 'trader_black', label: 'Black-market dealer', color: '#b078e0', letter: 'B' },
  { type: 'poi_town', label: 'POI: town', color: '#c25047', letter: 'P' },
  { type: 'poi_airport', label: 'POI: airport (hot)', color: '#d8a24a', letter: 'A' },
  { type: 'poi_hotzone', label: 'POI: high-loot zone', color: '#f05a3a', letter: 'H' },
];

export default function EditorPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<'map' | 'quests' | 'servers'>('map');
  const [denied, setDenied] = useState(false);
  const [w, setW] = useState(100);
  const [h, setH] = useState(100);
  const [pendingW, setPendingW] = useState(100);
  const [pendingH, setPendingH] = useState(100);
  const [tiles, setTiles] = useState<number[]>(() => new Array(100 * 100).fill(Tile.Grass));
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [tool, setTool] = useState<{ kind: 'tile'; tile: Tile } | { kind: 'object'; type: MapObjectType } | { kind: 'erase' }>({ kind: 'tile', tile: Tile.Grass });
  const [brush, setBrush] = useState(1);
  const [name, setName] = useState('Custom Map');
  const [status, setStatus] = useState('');
  const painting = useRef(false);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  // shrink cells for big maps so the whole thing stays on screen
  const scale = Math.max(4, Math.min(7, Math.floor(1000 / Math.max(w, h))));

  /** Resize the canvas, keeping everything already painted that still fits. */
  const applySize = () => {
    const nw = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pendingW | 0));
    const nh = Math.max(MIN_SIZE, Math.min(MAX_SIZE, pendingH | 0));
    setPendingW(nw);
    setPendingH(nh);
    if (nw === w && nh === h) return;
    setTiles((old) => {
      const next = new Array(nw * nh).fill(Tile.Grass);
      for (let y = 0; y < Math.min(h, nh); y++)
        for (let x = 0; x < Math.min(w, nw); x++) next[y * nw + x] = old[y * w + x];
      return next;
    });
    setObjects((os) => os.filter((o) => o.x < nw && o.y < nh));
    setW(nw);
    setH(nh);
    setStatus(`Canvas resized to ${nw}×${nh}`);
  };

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/map');
      if (res.status === 403) {
        setDenied(true);
        return;
      }
      const data = await res.json();
      if (data.map?.data) {
        const m = data.map.data as AuthoredMap;
        if (m.w >= MIN_SIZE && m.h >= MIN_SIZE && m.tiles.length === m.w * m.h) {
          setW(m.w);
          setH(m.h);
          setPendingW(m.w);
          setPendingH(m.h);
          setTiles(m.tiles);
          setObjects(m.objects);
          setName(data.map.name);
          setStatus(`Loaded active map (${m.w}×${m.h})`);
        }
      }
    })();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = tilesRef.current[y * w + x];
        ctx.fillStyle = TILE_TOOLS.find((tt) => tt.tile === t)?.color ?? (t === Tile.Bed ? '#7a8a99' : t === Tile.DoorMat ? '#7d6c48' : '#3f6b38');
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    // faint chunk grid every 10 tiles for orientation
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let x = 10; x < w; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x * scale + 0.5, 0);
      ctx.lineTo(x * scale + 0.5, h * scale);
      ctx.stroke();
    }
    for (let y = 10; y < h; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale + 0.5);
      ctx.lineTo(w * scale, y * scale + 0.5);
      ctx.stroke();
    }
    ctx.font = `${scale + 2}px monospace`;
    ctx.textAlign = 'center';
    for (const o of objects) {
      const ot = OBJECT_TOOLS.find((t) => t.type === o.type);
      if (!ot) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(o.x * scale - 1, o.y * scale - 1, scale + 2, scale + 2);
      ctx.fillStyle = ot.color;
      ctx.fillText(ot.letter, o.x * scale + scale / 2, o.y * scale + scale - 1);
      if (o.type === 'trader' || o.type.startsWith('poi')) {
        ctx.strokeStyle = ot.color;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(o.x * scale + scale / 2, o.y * scale + scale / 2, (o.r ?? (o.type === 'trader' ? 8 : 14)) * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }, [objects, w, h, scale]);

  useEffect(() => {
    redraw();
  }, [tiles, objects, redraw]);

  const applyAt = (px: number, py: number, erase: boolean) => {
    const x = Math.floor(px / scale);
    const y = Math.floor(py / scale);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (erase || tool.kind === 'erase') {
      // erase nearest object within 2 tiles, else reset tile to grass
      let bestI = -1;
      let bestD = 2.5;
      objects.forEach((o, i) => {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      if (bestI >= 0) setObjects((os) => os.filter((_, i) => i !== bestI));
      else {
        setTiles((ts) => {
          const next = ts.slice();
          next[y * w + x] = Tile.Grass;
          return next;
        });
      }
      return;
    }
    if (tool.kind === 'tile') {
      setTiles((ts) => {
        const next = ts.slice();
        const r = brush - 1;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) next[ny * w + nx] = tool.tile;
          }
        return next;
      });
    } else if (tool.kind === 'object') {
      const type = tool.type;
      const named = type === 'trader' || type.startsWith('poi');
      const objName = named ? window.prompt('Name for this location?', type === 'trader' ? 'Outpost' : 'Zone') ?? undefined : undefined;
      setObjects((os) => [...os, { type, x, y, ...(objName ? { name: objName } : {}) }]);
    }
  };

  const save = async () => {
    setStatus('Saving…');
    const res = await fetch('/api/admin/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: { w, h, tiles, objects } }),
    });
    const data = await res.json();
    setStatus(res.ok ? `Saved & activated (map #${data.id}). Restart the game API to load it.` : `Error: ${data.error}`);
  };

  if (denied) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <p>MAP BUILDER — admins only.</p>
          <p className="auth-hint" style={{ marginTop: 8 }}>Add your email to ADMIN_EMAILS in apps/web/.env.local</p>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-root">
      <div className="editor-side">
        <h2>ADMIN PANEL</h2>
        <div className="ed-tabs">
          <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>MAP</button>
          <button className={tab === 'quests' ? 'active' : ''} onClick={() => setTab('quests')}>QUESTS</button>
          <button className={tab === 'servers' ? 'active' : ''} onClick={() => setTab('servers')}>SERVERS</button>
        </div>
        {tab === 'map' && (<>
        <label className="ed-label">MAP NAME</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label className="ed-label">MAP SIZE (tiles, {MIN_SIZE}–{MAX_SIZE})</label>
        <div className="size-row">
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={pendingW}
            onChange={(e) => setPendingW(Number(e.target.value))}
            title="width"
          />
          <span>×</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={pendingH}
            onChange={(e) => setPendingH(Number(e.target.value))}
            title="height"
          />
          <button onClick={applySize}>APPLY</button>
        </div>
        <div className="ed-help">
          Current: {w}×{h}. Growing adds grass on the right/bottom; shrinking crops
          (placements outside are removed).
        </div>
        <label className="ed-label">TERRAIN</label>
        <div className="tool-grid">
          {TILE_TOOLS.map((t) => (
            <button
              key={t.tile}
              className={tool.kind === 'tile' && tool.tile === t.tile ? 'active' : ''}
              style={{ borderLeftColor: t.color }}
              onClick={() => setTool({ kind: 'tile', tile: t.tile })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ed-label">BRUSH {brush}×{brush}</label>
        <input type="range" min={1} max={5} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        <label className="ed-label">PLACEMENTS (click once)</label>
        <div className="tool-grid">
          {OBJECT_TOOLS.map((t) => (
            <button
              key={t.type}
              className={tool.kind === 'object' && tool.type === t.type ? 'active' : ''}
              style={{ borderLeftColor: t.color }}
              onClick={() => setTool({ kind: 'object', type: t.type })}
            >
              {t.letter} · {t.label}
            </button>
          ))}
          <button className={tool.kind === 'erase' ? 'active' : ''} style={{ borderLeftColor: '#c25047' }} onClick={() => setTool({ kind: 'erase' })}>
            ⌫ Erase (or right-click)
          </button>
        </div>
        <button className="btn-primary" onClick={save}>SAVE & ACTIVATE</button>
        <div className="ed-status">{status}</div>
        <div className="ed-help">
          Needed for a playable map: a few <b>S</b> spawns, a <b>T</b> trader outpost (safe zone),
          chests, loot and enemy spawns. Tiles paint by dragging.
        </div>
        </>)}
        {tab === 'quests' && (
          <div className="ed-help">Create jobs traders hand out — kill or fetch quests with credit/item rewards, chained via REQUIRES into a quest tree. Tier 2 quests only appear at black-market dealers. Changes go live within a minute, no restart needed.</div>
        )}
        {tab === 'servers' && (
          <div className="ed-help">Register game servers for the login-screen server browser. Hide instead of delete to take one down for maintenance.</div>
        )}
      </div>
      {tab === 'quests' && <QuestsEditor />}
      {tab === 'servers' && <ServersEditor />}
      <div className="editor-canvas-wrap" style={tab !== 'map' ? { display: 'none' } : undefined}>
        <canvas
          ref={canvasRef}
          width={w * scale}
          height={h * scale}
          onMouseDown={(e) => {
            painting.current = true;
            const r = e.currentTarget.getBoundingClientRect();
            applyAt(e.clientX - r.left, e.clientY - r.top, e.button === 2);
          }}
          onMouseMove={(e) => {
            if (!painting.current || tool.kind === 'object') return;
            const r = e.currentTarget.getBoundingClientRect();
            applyAt(e.clientX - r.left, e.clientY - r.top, (e.buttons & 2) !== 0);
          }}
          onMouseUp={() => (painting.current = false)}
          onMouseLeave={() => (painting.current = false)}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
