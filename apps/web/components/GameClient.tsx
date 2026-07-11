'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ActionSnap,
  BACKPACKS,
  BUILDABLES,
  ChatMsg,
  ContainerContents,
  EV,
  FLOOR_TILES,
  HitSnap,
  INTERACT_RANGE,
  ITEMS,
  InventoryUpdate,
  ItemId,
  KillFeedEntry,
  RECIPES,
  RecipeCat,
  SKILL_LIST,
  StateSnap,
  StationOpen,
  TILE,
  Tile,
  TileUpdate,
  TradeOpen,
  WorldInit,
  invCapacity,
  invWeight,
  isNight,
  skillLevel,
  useVerb,
  xpForLevel,
} from '@holdout/shared';
import { DamageFloat, RenderEnemy, RenderPlayer, Renderer } from '@/game/renderer';
import { ITEM_INDEX, ITEM_SHEET_ORDER, loadSheets } from '@/game/sprites';
import { initSfx, isMuted, sfx, startAmbient, toggleMute } from '@/game/sfx';
import { authClient } from '@/lib/auth-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MINIMAP_SIZE = 168;

interface Toast { id: number; msg: string }
interface FloatRec { x: number; y: number; amount: number; kind: DamageFloat['kind']; label?: string; at: number }
interface Friend { id: string; name: string; status: string; incoming: boolean }

const SKILL_ABBR: Record<string, string> = { woodcutting: 'WC', mining: 'MIN', shooting: 'SHT', melee: 'MEL', crafting: 'CRF' };

// starter objectives — gives new players a direction (tracked locally, once done stays done)
const OBJECTIVES: { id: string; label: string }[] = [
  { id: 'wood', label: 'Punch a tree for wood' },
  { id: 'spear', label: 'Craft a Wooden Spear (C)' },
  { id: 'kill', label: 'Make your first kill' },
  { id: 'cook', label: 'Cook a meal at a firepit' },
  { id: 'trade', label: 'Trade at the outpost' },
  { id: 'build', label: 'Build something at home (B)' },
  { id: 'extract', label: 'Extract from the zone' },
];

// tiles a player can reclaim in their own camp (built chests sit on grass, handled separately)
const DEMOLISHABLE = new Set<number>([
  Tile.WoodFloor, Tile.StoneFloor, Tile.WoodWall, Tile.Door, Tile.Fence, Tile.Torch,
  Tile.Workbench, Tile.Firepit, Tile.Furnace,
]);

type DragZone = 'inv' | 'cont' | 'helmet' | 'vest' | 'mod' | 'weapon';
interface DragState { zone: DragZone; index: number; item: ItemId; qty: number }
interface CtxMenu { x: number; y: number; zone: DragZone; index: number; item: ItemId; qty: number }

export function ItemIcon({ id, size = 28 }: { id: ItemId; size?: number }) {
  const i = ITEM_INDEX[id] ?? 0;
  const scale = size / 16;
  return (
    <span
      className="item-icon"
      style={{
        width: size,
        height: size,
        backgroundImage: 'url(/sprites/items.png)',
        backgroundPosition: `-${i * 16 * scale}px 0`,
        backgroundSize: `${ITEM_SHEET_ORDER.length * 16 * scale}px ${16 * scale}px`,
      }}
    />
  );
}

const CRAFT_TABS: { cat: RecipeCat; label: string }[] = [
  { cat: 'survival', label: 'SURVIVAL' },
  { cat: 'medical', label: 'MEDICAL' },
  { cat: 'ammo', label: 'AMMO' },
  { cat: 'gear', label: 'GEAR' },
  { cat: 'mods', label: 'MODS' },
  { cat: 'build', label: 'BUILD' },
];

const STATION_LABEL: Record<string, string> = { workbench: 'workbench', furnace: 'furnace' };

export default function GameClient() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const snapRef = useRef<StateSnap | null>(null);
  const initRef = useRef<WorldInit | null>(null);
  const youRef = useRef<string>('');
  const displayPos = useRef(new Map<string, { x: number; y: number }>());
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const mouse = useRef({ x: 0, y: 0, down: false });
  const panelsOpenRef = useRef(false);
  const floatsRef = useRef<FloatRec[]>([]);
  const bubblesRef = useRef(new Map<string, { text: string; at: number }>());
  const seenProjectiles = useRef(new Set<number>());
  const prevHpRef = useRef(100);
  const prevReloading = useRef(false);
  const containerRef = useRef<ContainerContents | null>(null);
  const locationRef = useRef<string | null>(null);
  const promptRef = useRef<string | null>(null);
  const safeRef = useRef(false);
  const friendNamesRef = useRef(new Set<string>());
  const latestInvRef = useRef<InventoryUpdate | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragConsumed = useRef(false);
  const lastStepAt = useRef(0);
  const lastGroanAt = useRef(0);
  const placingRef = useRef<{ slot: number; item: ItemId } | null>(null);
  const chatOpenRef = useRef(false);
  const menuRef = useRef({ gear: false, craft: false, skills: false, social: false });
  const lootContRef = useRef<string | null>(null); // container the loot queue belongs to
  const lootAwaitRef = useRef<{ slot: number; at: number } | null>(null); // fired, waiting on server
  const cookAwaitRef = useRef<{ slot: number; at: number } | null>(null);
  const craftAwaitRef = useRef<number | null>(null);
  const prevSkillsRef = useRef<InventoryUpdate['skills'] | null>(null);
  const promptPosRef = useRef<{ x: number; y: number } | null>(null);
  const clockRef = useRef('');
  const lastHowlAt = useRef(0);
  const lastGruntAt = useRef(0);
  const demolishRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState('');
  const [inv, setInv] = useState<InventoryUpdate | null>(null);
  const [showGear, setShowGear] = useState(false);
  const [showCraft, setShowCraft] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [craftTab, setCraftTab] = useState<RecipeCat>('survival');
  const [craftSel, setCraftSel] = useState<string | null>(null);
  const [container, setContainer] = useState<ContainerContents | null>(null);
  const [trade, setTrade] = useState<TradeOpen | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [feed, setFeed] = useState<(KillFeedEntry & { id: number })[]>([]);
  const [dead, setDead] = useState<string | null>(null);
  const [online, setOnline] = useState(0);
  const [location, setLocation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [inSafe, setInSafe] = useState(false);
  const [inHideout, setInHideout] = useState(false);
  const [ownHideout, setOwnHideout] = useState(false);
  const [hurtAt, setHurtAt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendUsername, setFriendUsername] = useState('');
  const [friendMsg, setFriendMsg] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatLog, setChatLog] = useState<(ChatMsg & { at: number })[]>([]);
  const [placing, setPlacing] = useState<{ slot: number; item: ItemId } | null>(null);
  const [action, setAction] = useState<{ label: string; until: number; ms: number; kind?: string; container?: string; slot?: number } | null>(null);
  const [lootQueue, setLootQueue] = useState<number[]>([]); // container slots queued for taking
  const [cookQueue, setCookQueue] = useState<number[]>([]); // inventory slots queued for cooking
  const [craftQueue, setCraftQueue] = useState<string[]>([]); // recipe ids queued for crafting
  const [station, setStation] = useState<'firepit' | null>(null); // open campfire UI
  const [clock, setClock] = useState('');
  const [demolishMode, setDemolishMode] = useState(false); // camp demolish mode (X)
  const [objectives, setObjectives] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('holdout_objectives') ?? '{}'); } catch { return {}; }
  });
  const chatInputRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const completeObjective = useCallback((id: string) => {
    setObjectives((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: true };
      localStorage.setItem('holdout_objectives', JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    initSfx();
    setMuted(isMuted());
  }, []);

  useEffect(() => { containerRef.current = container; }, [container]);
  useEffect(() => { latestInvRef.current = inv; }, [inv]);
  useEffect(() => { placingRef.current = placing; }, [placing]);
  useEffect(() => { demolishRef.current = demolishMode; }, [demolishMode]);
  // leave placement mode once the held kit runs out
  useEffect(() => {
    if (!placing) return;
    const s = inv?.inv.slots[placing.slot];
    if (!s || s.id !== placing.item || !ITEMS[s.id].place) setPlacing(null);
  }, [inv, placing]);
  // Loot queue: fire the next queued containerTake once the current timed action clears.
  // The server runs one action at a time, so queued clicks drain sequentially.
  useEffect(() => {
    if (action) { lootAwaitRef.current = null; return; } // server accepted — wait for completion
    if (lootQueue.length === 0) return;
    const cid = lootContRef.current;
    if (!cid || !container || container.id !== cid) {
      setLootQueue([]);
      lootContRef.current = null;
      return;
    }
    const valid = lootQueue.filter((i) => !!container.slots[i]);
    if (valid.length !== lootQueue.length) { setLootQueue(valid); return; }
    const next = valid[0];
    const aw = lootAwaitRef.current;
    if (aw && aw.slot === next && Date.now() - aw.at < 800) return; // request in flight
    lootAwaitRef.current = { slot: next, at: Date.now() };
    socketRef.current?.emit(EV.containerTake, { id: cid, slot: next });
  }, [action, container, lootQueue]);

  // starter objectives — flip flags as milestones happen, persist locally
  useEffect(() => {
    if (!inv) return;
    const has = (id: ItemId) => inv.inv.slots.some((s) => s && s.id === id);
    const next: Record<string, boolean> = { ...objectives };
    if (!next.wood && has('wood')) next.wood = true;
    if (!next.spear && (has('spear') || inv.inv.slots.some((s) => s && ITEMS[s.id].melee && s.id !== 'fishing_rod'))) next.spear = true;
    if (!next.kill && inv.kills > 0) next.kill = true;
    if (!next.cook && (has('cooked_meat') || has('cooked_fish'))) next.cook = true;
    if (JSON.stringify(next) !== JSON.stringify(objectives)) {
      setObjectives(next);
      localStorage.setItem('holdout_objectives', JSON.stringify(next));
    }
  }, [inv, objectives]);

  // the checklist retires itself once every objective is done
  useEffect(() => {
    if (objectives.celebrated) return;
    if (!OBJECTIVES.every((o) => objectives[o.id])) return;
    const done = { ...objectives, celebrated: true };
    setObjectives(done);
    localStorage.setItem('holdout_objectives', JSON.stringify(done));
    pushToast('🏆 Objectives complete — the zone is yours');
    sfx.levelUp();
  }, [objectives, pushToast]);

  useEffect(() => {
    if (trade) completeObjective('trade');
  }, [trade, completeObjective]);

  const enqueueLoot = useCallback((slot: number) => {
    const cont = containerRef.current;
    if (!cont) return;
    if (lootContRef.current !== cont.id) {
      lootContRef.current = cont.id;
      setLootQueue([slot]);
    } else {
      setLootQueue((q) => (q.includes(slot) ? q : [...q, slot]));
    }
  }, []);

  // Cook queue: keep cooking queued raw-food slots until each stack is done.
  useEffect(() => {
    if (action) { cookAwaitRef.current = null; return; }
    if (cookQueue.length === 0) return;
    const slots = inv?.inv.slots;
    if (!slots || !inv?.nearFirepit) { setCookQueue([]); return; }
    const valid = cookQueue.filter((i) => { const s = slots[i]; return s && ITEMS[s.id].raw; });
    if (valid.length !== cookQueue.length) { setCookQueue(valid); return; }
    const next = valid[0];
    const aw = cookAwaitRef.current;
    if (aw && aw.slot === next && Date.now() - aw.at < 800) return;
    cookAwaitRef.current = { slot: next, at: Date.now() };
    socketRef.current?.emit(EV.invUse, { slot: next });
  }, [action, inv, cookQueue]);
  // Craft queue: each craft is a timed server action; fire the next once the bar clears.
  useEffect(() => {
    if (action) { craftAwaitRef.current = null; return; }
    if (craftQueue.length === 0) return;
    const aw = craftAwaitRef.current;
    if (aw && Date.now() - aw < 900) {
      // fired but no action yet (server rejected or in flight) — re-check shortly
      const t = setTimeout(() => setCraftQueue((q) => [...q]), 950);
      return () => clearTimeout(t);
    }
    const id = craftQueue[0];
    setCraftQueue((q) => q.slice(1));
    const r = RECIPES.find((x) => x.id === id);
    const have = (iid: ItemId) => inv?.inv.slots.reduce((n, s) => n + (s && s.id === iid ? s.qty : 0), 0) ?? 0;
    if (!r || !r.cost.every((c) => have(c.id) >= c.qty)) return; // can no longer pay — skip
    craftAwaitRef.current = Date.now();
    socketRef.current?.emit(EV.craft, { recipe: id });
  }, [action, craftQueue, inv]);

  useEffect(() => {
    menuRef.current = { gear: showGear, craft: showCraft, skills: showSkills, social: showSocial };
  }, [showGear, showCraft, showSkills, showSocial]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) chatInputRef.current?.focus(); }, [chatOpen]);

  // exactly one full-screen menu open at a time (no stacking)
  const only = useCallback((which: 'gear' | 'craft' | 'skills' | 'social' | null) => {
    setShowGear(which === 'gear');
    setShowCraft(which === 'craft');
    setShowSkills(which === 'skills');
    setShowSocial(which === 'social');
    setTrade(null);
    setStation(null);
    if (which !== 'gear') { setContainer(null); socketRef.current?.emit(EV.containerClose); }
    if (which !== null) { setPlacing(null); setDemolishMode(false); }
  }, []);

  // begin holding a placeable item to place it (ghost preview follows the cursor)
  const startPlacing = useCallback((slot: number, item: ItemId) => {
    only(null);
    setCtxMenu(null);
    setDemolishMode(false);
    setPlacing({ slot, item });
    pushToast('Click the ground to place · ESC to cancel');
  }, [only, pushToast]);

  const toggleDemolish = useCallback(() => {
    if (!initRef.current?.ownHideout) {
      pushToast('Demolish only works in your own camp');
      return;
    }
    only(null);
    setPlacing(null);
    setDemolishMode((d) => !d);
  }, [only, pushToast]);

  // selecting a hotbar slot: placeables enter placement mode; weapons/tools/food
  // get held in hand (click to use/attack); armor/mods/backpacks apply immediately
  const useSlot = useCallback((i: number) => {
    const s = latestInvRef.current?.inv.slots[i];
    if (!s) return;
    const def = ITEMS[s.id];
    if (def.place) startPlacing(i, s.id);
    else if (def.kind === 'weapon' || def.kind === 'tool' || def.kind === 'consumable')
      socketRef.current?.emit(EV.invEquip, { slot: i });
    else socketRef.current?.emit(EV.invUse, { slot: i });
  }, [startPlacing]);

  // scroll wheel cycles the equipped weapon/tool across hotbar slots 1-5
  const cycleHotbar = useCallback((dir: number) => {
    const u = latestInvRef.current;
    if (!u) return;
    const cand: number[] = [];
    for (let i = 0; i < 5 && i < u.inv.slots.length; i++) {
      const s = u.inv.slots[i];
      const k = s && ITEMS[s.id].kind;
      if (k === 'weapon' || k === 'tool' || k === 'consumable') cand.push(i);
    }
    if (cand.length === 0) return;
    const at = u.equipped === null ? -1 : cand.indexOf(u.equipped);
    const next = at === -1
      ? (dir > 0 ? cand[0] : cand[cand.length - 1])
      : cand[(at + dir + cand.length) % cand.length];
    if (next === u.equipped) return;
    socketRef.current?.emit(EV.invEquip, { slot: next });
  }, []);

  const refreshFriends = useCallback(async () => {
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) return;
      const data = await res.json();
      setFriends(data.friends ?? []);
      friendNamesRef.current = new Set(
        (data.friends ?? []).filter((f: Friend) => f.status === 'accepted').map((f: Friend) => f.name),
      );
    } catch { /* offline is fine */ }
  }, []);

  useEffect(() => { void refreshFriends(); }, [refreshFriends]);

  // ── socket lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      const res = await fetch('/api/game-token', { method: 'POST' });
      if (res.status === 401) {
        router.replace('/');
        return;
      }
      if (!res.ok) {
        setFailed('Could not get a game session token.');
        return;
      }
      const { token } = await res.json();
      const sheets = await loadSheets();
      if (cancelled) return;

      socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect_error', () => setFailed('Cannot reach the game server. Is the API running on :3001?'));
      socket.on('disconnect', () => setConnected(false));
      socket.on(EV.init, (init: WorldInit) => {
        youRef.current = init.you;
        initRef.current = init;
        rendererRef.current = new Renderer(init.tiles, init.width, init.height, sheets, init.pois, init.traders, init.exit, init.extracts ?? []);
        displayPos.current.clear();
        seenProjectiles.current.clear();
        snapRef.current = null;
        setInHideout(init.kind === 'hideout');
        setOwnHideout(init.ownHideout);
        setPlacing(null);
        setDemolishMode(false);
        setStation(null);
        setContainer(null);
        setTrade(null);
        setConnected(true);
        setFailed('');
        setLocation(init.kind === 'hideout' ? init.name : null);
        locationRef.current = init.kind === 'hideout' ? init.name : null;
      });
      socket.on(EV.state, (s: StateSnap) => {
        snapRef.current = s;
        setOnline(s.players.length);
        const you = s.players.find((p) => p.id === youRef.current);
        const next = new Set<number>();
        for (const pr of s.projectiles) {
          next.add(pr.id);
          if (you && !seenProjectiles.current.has(pr.id)) {
            const d = Math.hypot(pr.x - you.x, pr.y - you.y);
            if (d < 420) sfx.shoot(Math.max(0.15, 1 - d / 460));
          }
        }
        seenProjectiles.current = next;
        // ambient creature sounds
        const now = performance.now();
        if (you && now - lastGroanAt.current > 2600) {
          for (const e of s.enemies) {
            if (e.kind !== 'zombie') continue;
            const d = Math.hypot(e.x - you.x, e.y - you.y);
            if (d < 320 && Math.random() < 0.35) {
              sfx.zombie(Math.max(0.2, 1 - d / 360));
              lastGroanAt.current = now;
              break;
            }
          }
        }
        if (you && now - lastGruntAt.current > 4500) {
          for (const e of s.enemies) {
            if (e.kind !== 'boar') continue;
            const d = Math.hypot(e.x - you.x, e.y - you.y);
            if (d < 220 && Math.random() < 0.4) {
              sfx.grunt(Math.max(0.2, 1 - d / 260));
              lastGruntAt.current = now;
              break;
            }
          }
        }
        // wolves howl in the dark
        const night = isNight(s.day);
        if (you && night && now - lastHowlAt.current > 20000) {
          for (const e of s.enemies) {
            if (e.kind !== 'wolf') continue;
            const d = Math.hypot(e.x - you.x, e.y - you.y);
            if (d < 550 && Math.random() < 0.5) {
              sfx.howl(Math.max(0.25, 1 - d / 650));
              lastHowlAt.current = now;
              break;
            }
          }
        }
      });
      socket.on(EV.inventory, (u: InventoryUpdate) => {
        setInv(u);
        if (u.hp < prevHpRef.current) {
          setHurtAt(Date.now());
          sfx.hurt();
        }
        prevHpRef.current = u.hp;
        if (u.reloading && !prevReloading.current) sfx.reload();
        prevReloading.current = u.reloading;
        if (u.hp > 0) setDead(null);
        // XP gain floats + level-up fanfare
        const prev = prevSkillsRef.current;
        if (prev) {
          for (const sk of SKILL_LIST) {
            const gained = (u.skills[sk.id] ?? 0) - (prev[sk.id] ?? 0);
            if (gained <= 0) continue;
            const you = snapRef.current?.players.find((p) => p.id === youRef.current);
            if (you) {
              floatsRef.current.push({
                x: you.x + (Math.random() - 0.5) * 12,
                y: you.y - 6,
                amount: gained,
                kind: 'xp',
                label: SKILL_ABBR[sk.id] ?? 'xp',
                at: performance.now(),
              });
            }
            const before = skillLevel(prev[sk.id] ?? 0);
            const after = skillLevel(u.skills[sk.id] ?? 0);
            if (after > before) {
              pushToast(`⭐ ${sk.name} reached LV ${after}`);
              sfx.levelUp();
            }
          }
        }
        prevSkillsRef.current = u.skills;
      });
      socket.on(EV.container, (c: ContainerContents) => {
        setContainer(c.slots.length === 0 ? null : c);
        if (c.slots.length > 0) setShowGear(true);
      });
      socket.on(EV.containerGone, (id: string) => {
        setContainer((c) => (c && c.id === id ? null : c));
      });
      socket.on(EV.trade, (t: TradeOpen) => setTrade(t));
      socket.on(EV.station, (s: StationOpen) => {
        if (s.type === 'firepit') {
          only(null);
          setStation('firepit');
        } else if (s.type === 'furnace') {
          setCraftTab('ammo');
          only('craft');
        } else if (s.type === 'workbench') {
          setCraftTab('mods');
          only('craft');
        }
      });
      socket.on(EV.toast, (msg: string) => {
        pushToast(msg);
        if (msg.startsWith('Picked up')) sfx.pickup();
        else if (msg.startsWith('Crafted') || msg.startsWith('Placed') || msg.startsWith('Bought') || msg.startsWith('Sold') || msg.startsWith('Job complete')) sfx.craft();
        if (msg.startsWith('Placed')) completeObjective('build');
        if (msg.startsWith('Extraction successful')) completeObjective('extract');
      });
      socket.on(EV.hit, (h: HitSnap) => {
        floatsRef.current.push({ x: h.x, y: h.y, amount: h.amount, kind: h.kind, at: performance.now() });
        rendererRef.current?.hitFx(h);
        const you = snapRef.current?.players.find((p) => p.id === youRef.current);
        const d = you ? Math.hypot(h.x - you.x, h.y - you.y) : 9999;
        if (d < 350) {
          if (h.kind === 'node') sfx.chop(Math.max(0.2, 1 - d / 380));
          else sfx.hit(Math.max(0.2, 1 - d / 380));
        }
      });
      socket.on(EV.tile, (u: TileUpdate) => rendererRef.current?.applyTile(u.i, u.tile));
      socket.on(EV.action, (a: ActionSnap) => {
        setAction(a.ms > 0 ? { label: a.label, until: Date.now() + a.ms, ms: a.ms, kind: a.kind, container: a.container, slot: a.slot } : null);
      });
      socket.on(EV.chatMsg, (m: ChatMsg) => {
        bubblesRef.current.set(m.id, { text: m.text, at: performance.now() });
        setChatLog((log) => [...log.slice(-5), { ...m, at: Date.now() }]);
      });
      socket.on(EV.killfeed, (k: KillFeedEntry) => {
        const id = Date.now() + Math.random();
        setFeed((f) => [...f.slice(-4), { ...k, id }]);
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 7000);
      });
      socket.on(EV.death, (d: { by: string }) => {
        setDead(d.by);
        setContainer(null);
        setTrade(null);
        sfx.death();
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [router, pushToast, only, completeObjective]);

  useEffect(() => {
    panelsOpenRef.current = showGear || showCraft || showSocial || showSkills || !!container || !!trade || chatOpen || !!ctxMenu || !!station;
  }, [showGear, showCraft, showSocial, showSkills, container, trade, chatOpen, ctxMenu, station]);

  // ── actions ─────────────────────────────────────────────────────────────
  const emit = useCallback((ev: string, payload?: unknown) => socketRef.current?.emit(ev, payload), []);

  const quickHeal = useCallback(() => {
    const u = latestInvRef.current;
    if (!u) return;
    let slot = u.inv.slots.findIndex((s) => s && s.id === 'bandage');
    if (slot < 0) slot = u.inv.slots.findIndex((s) => s && s.id === 'medkit');
    if (slot < 0) {
      pushToast('No bandages or medkits');
      return;
    }
    emit(EV.invUse, { slot });
  }, [emit, pushToast]);

  const sendChat = useCallback(() => {
    const text = chatText.trim();
    setChatOpen(false);
    setChatText('');
    if (text) emit(EV.chat, { text });
  }, [chatText, emit]);

  // ── keyboard / mouse ────────────────────────────────────────────────────
  useEffect(() => {
    const keyMap: Record<string, keyof typeof keys.current> = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (chatOpenRef.current) return; // chat input owns the keyboard
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.repeat && !keyMap[e.code]) return; // held keys must not spam interactions (E after extraction!)
      if (keyMap[e.code]) { keys.current[keyMap[e.code]] = true; e.preventDefault(); startAmbient(); }
      else if (e.code === 'KeyE') emit(EV.interact);
      else if (e.code === 'KeyR') emit(EV.reload);
      else if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); only(menuRef.current.gear ? null : 'gear'); }
      else if (e.code === 'KeyC') only(menuRef.current.craft ? null : 'craft');
      else if (e.code === 'KeyK') only(menuRef.current.skills ? null : 'skills');
      else if (e.code === 'KeyP') { only(menuRef.current.social ? null : 'social'); void refreshFriends(); }
      else if (e.code === 'KeyQ') quickHeal();
      else if (e.code === 'KeyB') {
        // hold the first placeable kit you own and place it
        const u = latestInvRef.current;
        const s = u?.inv.slots.findIndex((x) => x && ITEMS[x.id].place) ?? -1;
        if (u && s >= 0) startPlacing(s, u.inv.slots[s]!.id);
        else pushToast('Craft a firepit/workbench/furnace kit first (C → BUILD)');
      }
      else if (e.code === 'KeyX') toggleDemolish();
      else if (e.code === 'KeyM') setMuted(toggleMute());
      else if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); setChatOpen(true); }
      else if (/^Digit[1-5]$/.test(e.code)) useSlot(Number(e.code.slice(5)) - 1);
      else if (e.code === 'Escape') {
        only(null);
        setCtxMenu(null);
        setPlacing(null);
        setDemolishMode(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyMap[e.code]) keys.current[keyMap[e.code]] = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
      if (dragRef.current) setDragPos({ x: e.clientX, y: e.clientY });
    };
    const onMouseDown = (e: MouseEvent) => {
      // keep the context menu open when clicking its own buttons
      if (!(e.target instanceof Element && e.target.closest('.ctx-menu'))) setCtxMenu(null);
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest('.panel, .gear-screen, .death-overlay, .hotbar, .ctx-menu, button, input, .chat-bar')) return;
      // placement: click the ground to place the held kit
      const pl = placingRef.current;
      if (pl && snapRef.current) {
        const you = snapRef.current.players.find((p) => p.id === youRef.current);
        if (you) {
          const wx = you.x + (e.clientX - window.innerWidth / 2) / 2; // zoom = 2
          const wy = you.y + (e.clientY - window.innerHeight / 2) / 2;
          emit(EV.build, { slot: pl.slot, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) });
        }
        return;
      }
      // demolish mode: click a built piece to reclaim its kit
      if (demolishRef.current && snapRef.current) {
        const you = snapRef.current.players.find((p) => p.id === youRef.current);
        if (you) {
          const wx = you.x + (e.clientX - window.innerWidth / 2) / 2;
          const wy = you.y + (e.clientY - window.innerHeight / 2) / 2;
          emit(EV.demolish, { tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE) });
        }
        return;
      }
      mouse.current.down = true;
      startAmbient();
    };
    const onMouseUp = () => {
      mouse.current.down = false;
      // unconsumed drag ending outside slots: drop to ground when it came from the backpack
      if (dragRef.current) {
        const d = dragRef.current;
        setTimeout(() => {
          if (!dragConsumed.current && d.zone === 'inv') emit(EV.invDrop, { slot: d.index, qty: d.qty });
          dragRef.current = null;
          setDrag(null);
        }, 0);
      }
    };
    const onBlur = () => {
      keys.current = { up: false, down: false, left: false, right: false };
      mouse.current.down = false;
    };
    const onWheel = (e: WheelEvent) => {
      // let panels (crafting grid, stash) scroll normally; only steer the hotbar in-world
      if (panelsOpenRef.current || placingRef.current || demolishRef.current) return;
      cycleHotbar(e.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
    };
  }, [emit, quickHeal, toggleDemolish, refreshFriends, pushToast, only, startPlacing, useSlot, cycleHotbar]);

  // input + footsteps at 20Hz
  useEffect(() => {
    const timer = setInterval(() => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      const angle = Math.atan2(mouse.current.y - window.innerHeight / 2, mouse.current.x - window.innerWidth / 2);
      // menus freeze you in place (and stop attacks)
      const locked = panelsOpenRef.current;
      const dirs = locked
        ? { up: false, down: false, left: false, right: false }
        : keys.current;
      const moving = !locked && (keys.current.up || keys.current.down || keys.current.left || keys.current.right);
      socket.emit(EV.input, {
        ...dirs,
        angle,
        shoot: mouse.current.down && !locked && !placingRef.current && !demolishRef.current,
      });
      const now = performance.now();
      if (moving && now - lastStepAt.current > 340) {
        sfx.step();
        lastStepAt.current = now;
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // ── render loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const renderer = rendererRef.current;
      const snap = snapRef.current;
      const init = initRef.current;
      if (!renderer || !snap || !init) return;

      const f = 1 - Math.exp(-14 * dt);
      const seen = new Set<string>();
      const lerp = (id: string, x: number, y: number) => {
        seen.add(id);
        let d = displayPos.current.get(id);
        if (!d) {
          d = { x, y };
          displayPos.current.set(id, d);
        }
        if (Math.hypot(x - d.x, y - d.y) > 200) { d.x = x; d.y = y; }
        d.x += (x - d.x) * f;
        d.y += (y - d.y) * f;
        return d;
      };
      const players: RenderPlayer[] = snap.players.map((p) => {
        const d = lerp(p.id, p.x, p.y);
        return { ...p, dx: d.x, dy: d.y };
      });
      const enemies: RenderEnemy[] = snap.enemies.map((e) => {
        const d = lerp(e.id, e.x, e.y);
        return { ...e, dx: d.x, dy: d.y };
      });
      for (const id of displayPos.current.keys()) if (!seen.has(id)) displayPos.current.delete(id);

      floatsRef.current = floatsRef.current.filter((fl) => now - fl.at < 900);
      const floats: DamageFloat[] = floatsRef.current.map((fl) => ({
        x: fl.x, y: fl.y, amount: fl.amount, kind: fl.kind, label: fl.label, age: (now - fl.at) / 900,
      }));

      const meNow = players.find((p) => p.id === youRef.current);

      // build placement ghost — snap the cursor to a tile, mark valid/invalid
      let ghost: { tile: number; tx: number; ty: number; valid: boolean } | null = null;
      const pl = placingRef.current;
      if (pl && meNow) {
        const wx = meNow.dx + (mouse.current.x - canvas.width / 2) / renderer.zoom;
        const wy = meNow.dy + (mouse.current.y - canvas.height / 2) / renderer.zoom;
        const tx = Math.floor(wx / TILE);
        const ty = Math.floor(wy / TILE);
        const bt = ITEMS[pl.item].place;
        const tile = bt ? (BUILDABLES[bt].tile ?? -1) : -1;
        const inRange = Math.hypot((tx + 0.5) * TILE - meNow.dx, (ty + 0.5) * TILE - meNow.dy) <= TILE * 4;
        const under = renderer.tileAtPublic(tx, ty);
        // floors need grass; everything else can also go on top of flooring
        const isFloorKit = bt === 'wood_floor' || bt === 'stone_floor';
        const groundOk = isFloorKit ? under === Tile.Grass : under === Tile.Grass || !!FLOOR_TILES[under];
        ghost = { tile, tx, ty, valid: inRange && groundOk };
      }

      // demolish marker — is there a reclaimable piece under the cursor?
      let demolish: { tx: number; ty: number; valid: boolean } | null = null;
      if (demolishRef.current && meNow) {
        const wx = meNow.dx + (mouse.current.x - canvas.width / 2) / renderer.zoom;
        const wy = meNow.dy + (mouse.current.y - canvas.height / 2) / renderer.zoom;
        const tx = Math.floor(wx / TILE);
        const ty = Math.floor(wy / TILE);
        const inRange = Math.hypot((tx + 0.5) * TILE - meNow.dx, (ty + 0.5) * TILE - meNow.dy) <= TILE * 4;
        const builtChest = snap.containers.some(
          (c) => c.id.startsWith('hc:') && Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty,
        );
        demolish = { tx, ty, valid: inRange && (DEMOLISHABLE.has(renderer.tileAtPublic(tx, ty)) || builtChest) };
      }

      renderer.draw(ctx, canvas.width, canvas.height, {
        players,
        enemies,
        projectiles: snap.projectiles,
        containers: snap.containers,
        ground: snap.ground,
        floats,
        bubbles: bubblesRef.current,
        youId: youRef.current,
        friendNames: friendNamesRef.current,
        time: now / 1000,
        serverNow: snap.t,
        day: snap.day,
        ghost,
        highlight: promptPosRef.current,
        demolish,
      });

      // day/night clock for the HUD
      const dayMins = Math.floor(snap.day * 24 * 60);
      const clockH = String(Math.floor(dayMins / 60)).padStart(2, '0');
      const clockM = String(Math.floor((dayMins % 60) / 10) * 10).padStart(2, '0');
      const clockLabel = `${isNight(snap.day) ? '☾' : '☀'} ${clockH}:${clockM}`;
      if (clockLabel !== clockRef.current) {
        const wasNight = clockRef.current.startsWith('☾');
        const nowNight = clockLabel.startsWith('☾');
        if (clockRef.current && wasNight !== nowNight)
          pushToast(nowNight ? '☾ Night falls — the dead grow restless' : '☀ Dawn breaks over the zone');
        clockRef.current = clockLabel;
        setClock(clockLabel);
      }

      const you = meNow;
      const mm = minimapRef.current;
      if (mm && you) {
        renderer.drawMinimap(mm.getContext('2d')!, MINIMAP_SIZE, {
          pois: init.pois,
          players,
          youId: youRef.current,
          friendNames: friendNamesRef.current,
        });
      }

      if (you) {
        let loc: string | null = init.kind === 'hideout' ? init.name : null;
        let safe = init.kind === 'hideout';
        for (const poi of init.pois) {
          if (Math.hypot(you.dx - poi.x, you.dy - poi.y) < poi.r) {
            loc = poi.name;
            if (poi.safe) safe = true;
            break;
          }
        }
        if (loc !== locationRef.current) {
          locationRef.current = loc;
          setLocation(loc);
        }
        if (safe !== safeRef.current) {
          safeRef.current = safe;
          setInSafe(safe);
        }

        let bestPrompt: string | null = null;
        let bestPos: { x: number; y: number } | null = null;
        let bestD = INTERACT_RANGE;
        if (init.kind === 'hideout' && init.exit) {
          const d = Math.hypot(init.exit.x - you.dx, init.exit.y - you.dy);
          if (d < bestD) { bestD = d; bestPrompt = 'Deploy into the zone'; bestPos = init.exit; }
        }
        for (const tr of init.traders) {
          const d = Math.hypot(tr.x - you.dx, tr.y - you.dy);
          if (d < bestD) { bestD = d; bestPrompt = 'Trade & jobs'; bestPos = tr; }
        }
        for (const ex of init.extracts ?? []) {
          const d = Math.hypot(ex.x - you.dx, ex.y - you.dy);
          if (d < bestD) { bestD = d; bestPrompt = 'Extract home (hold 5s)'; bestPos = ex; }
        }
        // placed stations (campfire cook menu, furnace/workbench crafting)
        {
          const ptx = Math.floor(you.dx / TILE);
          const pty = Math.floor(you.dy / TILE);
          for (let ty2 = pty - 2; ty2 <= pty + 2; ty2++)
            for (let tx2 = ptx - 2; tx2 <= ptx + 2; tx2++) {
              const t = renderer.tileAtPublic(tx2, ty2);
              const label =
                t === Tile.Firepit ? 'Cook at the campfire'
                : t === Tile.Furnace ? 'Use furnace (ammo)'
                : t === Tile.Workbench ? 'Use workbench (mods)'
                : null;
              if (!label) continue;
              const cx = (tx2 + 0.5) * TILE;
              const cy = (ty2 + 0.5) * TILE;
              const d = Math.hypot(cx - you.dx, cy - you.dy);
              if (d < bestD) { bestD = d; bestPrompt = label; bestPos = { x: cx, y: cy }; }
            }
        }
        for (const c of snap.containers) {
          const d = Math.hypot(c.x - you.dx, c.y - you.dy);
          if (d < bestD) {
            bestD = d;
            bestPos = { x: c.x, y: c.y };
            bestPrompt =
              c.kind === 'bag' ? 'Search loot bag'
              : c.kind === 'crate' ? (c.looted ? 'Search crate (empty)' : 'Search supply crate')
              : c.kind === 'storage' ? 'Open stash'
              : c.looted ? 'Open chest (empty)' : 'Open chest';
          }
        }
        for (const g of snap.ground) {
          const d = Math.hypot(g.x - you.dx, g.y - you.dy);
          if (d < bestD) {
            bestD = d;
            bestPos = { x: g.x, y: g.y };
            bestPrompt = `Pick up ${ITEMS[g.item].name}${g.qty > 1 ? ` ×${g.qty}` : ''}`;
          }
        }
        promptPosRef.current = bestPos;
        if (bestPrompt !== promptRef.current) {
          promptRef.current = bestPrompt;
          setPrompt(bestPrompt);
        }

        const open = containerRef.current;
        if (open) {
          const c = snap.containers.find((x) => x.id === open.id);
          if (!c || Math.hypot(c.x - you.dx, c.y - you.dy) > 90) {
            containerRef.current = null;
            setContainer(null);
            emit(EV.containerClose);
          }
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [connected, emit, pushToast]);

  // ── drag & drop plumbing ────────────────────────────────────────────────
  const beginDrag = (zone: DragZone, index: number, item: ItemId, qty: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragConsumed.current = false;
    dragRef.current = { zone, index, item, qty };
    setDrag(dragRef.current);
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const dropOn = (zone: DragZone, index: number) => {
    const d = dragRef.current;
    if (!d) return;
    dragConsumed.current = true;
    const cont = containerRef.current;
    if (d.zone === 'inv') {
      if (zone === 'inv' && index !== d.index) emit(EV.invMove, { from: d.index, to: index });
      else if (zone === 'cont' && cont) {
        emit(EV.containerPut, { id: cont.id, slot: d.index }); // dump into any open container
      } else if (zone === 'weapon') {
        const kind = ITEMS[d.item].kind;
        if (kind === 'weapon' || kind === 'tool') emit(EV.invEquip, { slot: d.index });
        else pushToast('That is not a weapon');
      } else if (zone === 'helmet' || zone === 'vest' || zone === 'mod') {
        const def = ITEMS[d.item];
        const fits = (zone === 'mod' && def.kind === 'mod') || (def.armor && def.armor.piece === zone);
        if (fits) emit(EV.invUse, { slot: d.index });
        else pushToast(`That does not fit the ${zone.toUpperCase()} slot`);
      }
    } else if (d.zone === 'cont' && cont) {
      if (zone !== 'cont') enqueueLoot(d.index);
    } else if (d.zone === 'helmet' || d.zone === 'vest' || d.zone === 'mod') {
      if (zone === 'inv' || zone === 'weapon') emit(EV.unequipArmor, { piece: d.zone });
    } else if (d.zone === 'weapon') {
      if (zone === 'inv') emit(EV.invEquip, { slot: d.index }); // toggles off
    }
    dragRef.current = null;
    setDrag(null);
  };

  const openCtx = (zone: DragZone, index: number, item: ItemId, qty: number, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, zone, index, item, qty });
  };

  const ctxAction = (action: string) => {
    const m = ctxMenu;
    setCtxMenu(null);
    if (!m) return;
    const cont = containerRef.current;
    switch (action) {
      case 'use': emit(EV.invUse, { slot: m.index }); break;
      case 'place': startPlacing(m.index, m.item); break;
      case 'unequip': emit(EV.unequipArmor, { piece: m.zone }); break;
      case 'drop1': emit(EV.invDrop, { slot: m.index, qty: 1 }); break;
      case 'dropall': emit(EV.invDrop, { slot: m.index, qty: m.qty }); break;
      case 'store': if (cont) emit(EV.containerPut, { id: cont.id, slot: m.index }); break;
      case 'take': if (cont) enqueueLoot(m.index); break;
    }
  };

  const countOf = (id: ItemId) => inv?.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0) ?? 0;

  const equippedItem = inv && inv.equipped !== null ? inv.inv.slots[inv.equipped] : null;
  const eqWeapon = equippedItem ? ITEMS[equippedItem.id].weapon : null;
  const ammoReserve = eqWeapon ? countOf(eqWeapon.ammo) : null;
  const weight = inv ? invWeight(inv.inv) : 0;
  const cap = inv ? invCapacity(inv.inv) : BACKPACKS[0];

  const leave = async () => {
    socketRef.current?.disconnect();
    await authClient.signOut();
    router.push('/');
  };

  const addFriend = async () => {
    setFriendMsg('');
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: friendUsername }),
    });
    const data = await res.json();
    setFriendMsg(res.ok ? (data.status === 'accepted' ? `You are now allies with ${data.name}` : `Request sent to ${data.name}`) : data.error);
    setFriendUsername('');
    void refreshFriends();
  };

  const acceptFriend = async (id: string) => {
    await fetch('/api/friends', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void refreshFriends();
  };

  if (failed) {
    return (
      <div className="game-root">
        <div className="connect-overlay">
          <div style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: 12 }}>{failed}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>RETRY</button>{' '}
            <button className="btn-primary" onClick={leave}>LOG OUT</button>
          </div>
        </div>
      </div>
    );
  }

  const invSlot = (s: { id: ItemId; qty: number } | null, i: number) => (
    <div
      key={i}
      className={`slot${inv?.equipped === i ? ' equipped' : ''}${drag?.zone === 'inv' && drag.index === i ? ' dragging' : ''}`}
      onMouseDown={(e) => {
        if (!s) return;
        // shift-click: quick-deposit into whatever container is open
        if (e.shiftKey && containerRef.current) {
          e.preventDefault();
          emit(EV.containerPut, { id: containerRef.current.id, slot: i });
          return;
        }
        beginDrag('inv', i, s.id, s.qty, e);
      }}
      onMouseUp={() => dropOn('inv', i)}
      onContextMenu={(e) => s && openCtx('inv', i, s.id, s.qty, e)}
      onDoubleClick={() => s && useSlot(i)}
      title={s ? `${ITEMS[s.id].name} — ${ITEMS[s.id].desc}` : ''}
    >
      {i < 5 && <span className="keycap">{i + 1}</span>}
      {s && (<><ItemIcon id={s.id} />{s.qty > 1 && <span className="qty">{s.qty}</span>}</>)}
    </div>
  );

  const equipSlot = (zone: 'helmet' | 'vest' | 'mod', label: string) => {
    const id = inv?.equipment[zone] ?? null;
    return (
      <div
        className="equip-slot"
        onMouseDown={(e) => id && beginDrag(zone, 0, id, 1, e)}
        onMouseUp={() => dropOn(zone, 0)}
        onContextMenu={(e) => id && openCtx(zone, 0, id, 1, e)}
        title={id ? ITEMS[id].name : label}
      >
        <span className="corner">{label}</span>
        {id && <ItemIcon id={id} size={32} />}
      </div>
    );
  };

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="world" style={placing || demolishMode ? { cursor: 'crosshair' } : undefined} />
      {!connected && <div className="connect-overlay">CONNECTING TO THE ZONE…</div>}
      {hurtAt > 0 && <div className="hurt-flash" key={hurtAt} />}

      {connected && (
        <div className="minimap-wrap">
          <canvas ref={minimapRef} width={MINIMAP_SIZE} height={MINIMAP_SIZE} />
        </div>
      )}

      {location && <div className="location-banner" key={location}>{location.toUpperCase()}</div>}
      {inSafe && !inHideout && <div className="safe-chip">SAFE ZONE — ENTER chat · extract to get home</div>}
      {inHideout && <div className="safe-chip">{ownHideout ? 'HOME BASE — B build · X demolish · walk the mat to deploy' : 'ALLY CAMP — E on the mat to leave'}</div>}
      {placing && (
        <div className="build-bar">
          <span>PLACING <b>{ITEMS[placing.item].name}</b>{(inv?.inv.slots[placing.slot]?.qty ?? 0) > 1 ? ` ×${inv!.inv.slots[placing.slot]!.qty}` : ''}</span>
          <span className="build-hint">
            click the ground to place{inHideout ? '' : ' — wears out & is destructible in the world'} · ESC cancel
          </span>
          <button onClick={() => setPlacing(null)}>CANCEL</button>
        </div>
      )}
      {demolishMode && (
        <div className="build-bar demolish">
          <span>DEMOLISH MODE</span>
          <span className="build-hint">click a built piece to reclaim its kit (chests must be empty) · X or ESC to exit</span>
          <button onClick={() => setDemolishMode(false)}>DONE</button>
        </div>
      )}

      {/* timed action progress (looting / fishing / drinking / cooking) */}
      {action && (
        <div className="action-bar">
          <div className="a-label">{action.label}</div>
          <div className="a-track">
            <div
              className="a-fill"
              key={action.until}
              style={{ animationDuration: `${action.ms}ms` }}
            />
          </div>
        </div>
      )}

      {prompt && !panelsOpenRef.current && <div className="prompt"><b>E</b> {prompt}</div>}

      {/* HUD */}
      {inv && (
        <div className="hud">
          <div className="bar">
            <div className="fill" style={{ width: `${inv.hp}%`, background: inv.hp > 50 ? 'var(--green)' : inv.hp > 25 ? 'var(--gold)' : 'var(--red)' }} />
            <div className="label">HP {inv.hp}/100</div>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: `${Math.min(100, (weight / cap.maxKg) * 100)}%`, background: 'var(--blue)' }} />
            <div className="label">{weight.toFixed(1)} / {cap.maxKg} KG</div>
          </div>
          <div className="survival-row">
            <div className="bar mini" title="Hunger — hunt deer, fish, cook at a firepit">
              <div className="fill" style={{ width: `${inv.hunger}%`, background: '#c08a3a' }} />
              <div className="label">FOOD {inv.hunger}</div>
            </div>
            <div className="bar mini" title="Thirst — drink at water (E) or carry a canteen">
              <div className="fill" style={{ width: `${inv.thirst}%`, background: '#4a90c8' }} />
              <div className="label">H2O {inv.thirst}</div>
            </div>
          </div>
          <div className="weapon-line">
            {equippedItem
              ? eqWeapon
                ? inv.reloading
                  ? `${ITEMS[equippedItem.id].name} · RELOADING…`
                  : `${ITEMS[equippedItem.id].name} · ${inv.mag}/${eqWeapon.magSize} · ${ammoReserve} reserve ${inv.mag === 0 ? '· R to reload' : ''}`
                : ITEMS[equippedItem.id].kind === 'consumable'
                  ? `${ITEMS[equippedItem.id].name} · ${(useVerb(ITEMS[equippedItem.id]) ?? 'USE')} — left-click`
                  : ITEMS[equippedItem.id].name
              : 'FISTS — punch trees & rocks, craft a spear (C)'}
          </div>
        </div>
      )}

      {/* hotbar */}
      {inv && (
        <div className="hotbar">
          {inv.inv.slots.slice(0, 5).map((s, i) => (
            <div key={i} className={`slot${inv.equipped === i ? ' equipped' : ''}`} onClick={() => useSlot(i)} title={s ? ITEMS[s.id].name : ''}>
              <span className="keycap">{i + 1}</span>
              {s && (<><ItemIcon id={s.id} />{s.qty > 1 && <span className="qty">{s.qty}</span>}</>)}
            </div>
          ))}
        </div>
      )}

      {/* contextual interaction hints (fish / drink / cook) */}
      {inv && !panelsOpenRef.current && !placing && (() => {
        const hasRod = equippedItem?.id === 'fishing_rod';
        const rawHeld = inv.inv.slots.filter((s) => s && ITEMS[s.id].raw) as { id: ItemId; qty: number }[];
        const hints: string[] = [];
        if (inv.nearWater) {
          hints.push(inv.thirst < 100 ? 'E — drink from the water' : 'Water here');
          if (hasRod) hints.push('LMB — cast the line');
          else hints.push('equip a rod to fish');
        }
        if (inv.nearFirepit && rawHeld.length) hints.push('right-click raw food → cook');
        if (!hints.length) return null;
        return (
          <div className="interact-hints">
            {inv.nearFirepit ? '🔥 FIREPIT' : '💧 WATER'}
            {hints.map((h, i) => <span key={i}>{h}</span>)}
          </div>
        );
      })()}

      <div className="top-right">
        <div className="online-chip">● {online} IN ZONE</div>
        {clock && <div className="kd-chip dim">{clock}</div>}
        {inv && <div className="kd-chip gold">{inv.money} cr</div>}
        {inv && <div className="kd-chip">☠ {inv.kills} · {inv.deaths}</div>}
        <div className="kd-chip dim">{muted ? '🔇 M' : '🔊 M'}</div>
        <div className="killfeed">
          {feed.map((k) => (
            <div key={k.id}><b>{k.killer}</b> ☠ {k.victim}{k.weapon ? ` (${ITEMS[k.weapon].name})` : ''}</div>
          ))}
        </div>
      </div>

      <div className="hotkey-bar">
        {([
          ['🎒', 'TAB', 'Gear & inventory', () => only(menuRef.current.gear ? null : 'gear')],
          ['⚒', 'C', 'Crafting', () => only(menuRef.current.craft ? null : 'craft')],
          ['📈', 'K', 'Skills', () => only(menuRef.current.skills ? null : 'skills')],
          ['👥', 'P', 'Contacts', () => { only(menuRef.current.social ? null : 'social'); void refreshFriends(); }],
          // building controls only show at home — out in the zone the hotbar stays lean
          ...(ownHideout
            ? ([
                ['🔨', 'B', 'Place a build kit', () => {
                  const s = inv?.inv.slots.findIndex((x) => x && ITEMS[x.id].place) ?? -1;
                  if (inv && s >= 0) startPlacing(s, inv.inv.slots[s]!.id);
                  else pushToast('Craft a build kit first (C → BUILD)');
                }],
                ['⛏', 'X', 'Demolish (your camp)', toggleDemolish],
              ] as [string, string, string, () => void][])
            : []),
          ['💬', '⏎', 'Chat (safe zones)', () => setChatOpen(true)],
          ['🔊', 'M', 'Sound on/off', () => setMuted(toggleMute())],
        ] as [string, string, string, () => void][]).map(([icon, key, label, fn]) => (
          <button key={key} className="hk" onClick={fn}>
            <span className="hk-icon">{icon}</span>
            <span className="hk-tip">{label} <b>{key}</b></span>
          </button>
        ))}
      </div>

      <div className="toasts">{toasts.map((t) => <div key={t.id}>{t.msg}</div>)}</div>

      {/* chat log + input */}
      <div className="chat-log">
        {chatLog.filter((m) => Date.now() - m.at < 12000).map((m, i) => (
          <div key={i}><b>{m.name}:</b> {m.text}</div>
        ))}
      </div>
      {chatOpen && (
        <div className="chat-bar">
          <input
            ref={chatInputRef}
            value={chatText}
            maxLength={120}
            placeholder={inSafe ? 'say something…' : 'chat only works in safe zones'}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendChat();
              else if (e.key === 'Escape') { setChatOpen(false); setChatText(''); }
              e.stopPropagation();
            }}
          />
        </div>
      )}

      {/* ── GEAR SCREEN (drag & drop) ─────────────────────────────── */}
      {(showGear || container) && inv && (
        <div className="gear-screen">
          <section className="gear-col">
            <h3>INVENTORY</h3>
            <div className="slot-grid">{inv.inv.slots.map((s, i) => invSlot(s, i))}</div>
            <div className={`weight-bar${weight > cap.maxKg ? ' over' : ''}`}>
              <div className="fill" style={{ width: `${Math.min(100, (weight / cap.maxKg) * 100)}%` }} />
              <div className="label">{weight.toFixed(1)} / {cap.maxKg} KG · {inv.money} cr</div>
            </div>
            <div className="item-desc">
              Drag to move · right-click for options · double-click to use
              {container ? ' · shift-click to deposit' : ''}
            </div>
          </section>

          <section className="gear-col equip-center">
            <h3>EQUIPMENT</h3>
            <div
              className="equip-slot big"
              onMouseDown={(e) => equippedItem && inv.equipped !== null && beginDrag('weapon', inv.equipped, equippedItem.id, 1, e)}
              onMouseUp={() => dropOn('weapon', 0)}
              onContextMenu={(e) => equippedItem && inv.equipped !== null && openCtx('inv', inv.equipped, equippedItem.id, 1, e)}
            >
              <span className="corner">[1]</span>
              {equippedItem ? (
                <>
                  <ItemIcon id={equippedItem.id} size={40} />
                  <span className="equip-name">{ITEMS[equippedItem.id].name}{eqWeapon ? ` · ${inv.mag}/${eqWeapon.magSize}` : ''}</span>
                </>
              ) : (
                <span className="equip-label">HANDS — FISTS</span>
              )}
            </div>
            <div className="equip-row3">
              {equipSlot('helmet', 'HEAD')}
              {equipSlot('vest', 'BODY')}
              {equipSlot('mod', 'MOD')}
            </div>
            <div className="equip-meta">
              <div>{cap.name} · {cap.slots} slots</div>
              <div className="dim">Backpack upgrades apply on use</div>
              {inv.nearWorkbench && <div className="wb-chip">⚒ WORKBENCH IN RANGE</div>}
            </div>
            <div className="quick-label">QUICK SLOTS</div>
            <div className="quick-row">{inv.inv.slots.slice(0, 5).map((s, i) => invSlot(s, i))}</div>
          </section>

          {container && (
            <section className="gear-col">
              <h3>{container.storage ? 'STASH' : container.id.startsWith('b') ? 'LOOT BAG' : 'STORAGE'}<span className="sub">click to take</span></h3>
              <div className="slot-grid">
                {container.slots.map((s, i) => {
                  const looting = !!action && action.kind === 'loot' && action.container === container.id && action.slot === i;
                  const queuePos = !looting && lootContRef.current === container.id ? lootQueue.indexOf(i) : -1;
                  return (
                    <div
                      key={i}
                      className={`slot${drag?.zone === 'cont' && drag.index === i ? ' dragging' : ''}${looting ? ' looting' : ''}${queuePos >= 0 ? ' queued' : ''}`}
                      onMouseDown={(e) => s && beginDrag('cont', i, s.id, s.qty, e)}
                      onMouseUp={() => dropOn('cont', i)}
                      onClick={() => s && enqueueLoot(i)}
                      onContextMenu={(e) => s && openCtx('cont', i, s.id, s.qty, e)}
                      title={s ? ITEMS[s.id].name : ''}
                    >
                      {s && (<><ItemIcon id={s.id} />{s.qty > 1 && <span className="qty">{s.qty}</span>}</>)}
                      {looting && (
                        <div className="loot-ring" title="taking…">
                          <svg viewBox="0 0 40 40" width="40" height="40">
                            <circle className="track" cx="20" cy="20" r="16" />
                            <circle className="prog" cx="20" cy="20" r="16" key={action.until} style={{ animationDuration: `${action.ms}ms` }} />
                          </svg>
                        </div>
                      )}
                      {queuePos >= 0 && <span className="queue-badge">{queuePos + 1}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="item-actions">
                {!container.storage && (
                  <button
                    onClick={() => {
                      lootContRef.current = container.id;
                      setLootQueue(container.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0));
                    }}
                  >
                    {lootQueue.length > 0 ? `TAKING… (${lootQueue.length})` : 'TAKE ALL'}
                  </button>
                )}
                <button onClick={() => { setLootQueue([]); lootContRef.current = null; setContainer(null); emit(EV.containerClose); }}>CLOSE</button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* drag ghost */}
      {drag && (
        <div className="drag-ghost" style={{ left: dragPos.x - 16, top: dragPos.y - 16 }}>
          <ItemIcon id={drag.item} size={32} />
        </div>
      )}

      {/* context menu */}
      {ctxMenu && (
        <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="ctx-title">{ITEMS[ctxMenu.item].name}</div>
          {ctxMenu.zone === 'inv' && (() => {
            const def = ITEMS[ctxMenu.item];
            const verb = useVerb(def);
            return (
              <>
                {verb && <button onClick={() => ctxAction(def.place ? 'place' : 'use')}>{verb}</button>}
                {container && <button onClick={() => ctxAction('store')}>{container.storage ? 'STASH' : 'STORE'}</button>}
                <button onClick={() => ctxAction('drop1')}>DROP 1</button>
                <button onClick={() => ctxAction('dropall')}>DROP ALL</button>
              </>
            );
          })()}
          {ctxMenu.zone === 'cont' && <button onClick={() => ctxAction('take')}>TAKE</button>}
          {(ctxMenu.zone === 'helmet' || ctxMenu.zone === 'vest' || ctxMenu.zone === 'mod') && (
            <button onClick={() => ctxAction('unequip')}>UNEQUIP</button>
          )}
        </div>
      )}

      {/* Crafting: category tabs → icon grid → detail with craft queue */}
      {showCraft && inv && (() => {
        const hasStation = (st?: string) => !st || (st === 'workbench' ? inv.nearWorkbench : st === 'furnace' ? inv.nearFurnace : true);
        const canMake = (r: typeof RECIPES[number]) => r.cost.every((c) => countOf(c.id) >= c.qty) && hasStation(r.station);
        const list = RECIPES.filter((r) => r.cat === craftTab);
        const r = list.find((x) => x.id === craftSel) ?? list[0];
        const queuedOf = (id: string) => craftQueue.filter((q) => q === id).length;
        const enqueue = (id: string, n = 1) => setCraftQueue((q) => [...q, ...new Array<string>(n).fill(id)]);
        return (
          <div className="panel craft-panel">
            <h3>
              CRAFTING
              <span className="sub">
                {craftQueue.length > 0 ? `⏳ ${craftQueue.length} queued · ` : ''}C to close
              </span>
            </h3>
            <div className="craft-tabs">
              {CRAFT_TABS.map((t) => (
                <button key={t.cat} className={craftTab === t.cat ? 'active' : ''} onClick={() => { setCraftTab(t.cat); setCraftSel(null); }}>{t.label}</button>
              ))}
            </div>
            <div className="craft-body">
              <div className="craft-grid">
                {list.map((rc) => {
                  const ok = canMake(rc);
                  const nq = queuedOf(rc.id);
                  return (
                    <button
                      key={rc.id}
                      className={`craft-cell${(r && r.id === rc.id) ? ' active' : ''}${ok ? ' craftable' : ' locked'}`}
                      title={`${ITEMS[rc.out.id].name}${rc.station ? ` — needs a ${STATION_LABEL[rc.station]}` : ''}`}
                      onClick={() => setCraftSel(rc.id)}
                      onDoubleClick={() => ok && enqueue(rc.id)}
                    >
                      <ItemIcon id={rc.out.id} size={28} />
                      {rc.out.qty > 1 && <span className="cc-qty">×{rc.out.qty}</span>}
                      {rc.station && <span className="cc-station">⚒</span>}
                      {nq > 0 && <span className="queue-badge">{nq}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="craft-detail">
                {r && (() => {
                  const ok = canMake(r);
                  const nq = queuedOf(r.id);
                  return (
                    <>
                      <div className="cd-head"><ItemIcon id={r.out.id} size={40} /><div><b>{ITEMS[r.out.id].name}</b>{r.out.qty > 1 && <span className="cd-qty"> ×{r.out.qty}</span>}</div></div>
                      <div className="cd-desc">{ITEMS[r.out.id].desc}</div>
                      <div className="cd-req">REQUIRES</div>
                      <div className="cd-costs">
                        {r.cost.map((c) => (
                          <div key={c.id} className={countOf(c.id) >= c.qty ? 'have' : 'missing'}>
                            <ItemIcon id={c.id} size={18} /> {ITEMS[c.id].name}
                            <span className="cd-count">{countOf(c.id)}/{c.qty}</span>
                          </div>
                        ))}
                      </div>
                      {r.station && !hasStation(r.station) && (
                        <div className="cd-warn">Stand next to a {STATION_LABEL[r.station]} (craft & place its kit from BUILD)</div>
                      )}
                      <div className="craft-actions">
                        <button className="btn-primary craft-go" disabled={!ok} onClick={() => enqueue(r.id)}>
                          {ok ? (nq > 0 ? `CRAFT (+${nq} queued)` : 'CRAFT') : r.station && !hasStation(r.station) ? `NEED ${STATION_LABEL[r.station!].toUpperCase()}` : 'MISSING MATERIALS'}
                        </button>
                        <button className="btn-primary craft-go x5" disabled={!ok} onClick={() => enqueue(r.id, 5)}>×5</button>
                        {craftQueue.length > 0 && (
                          <button className="craft-clear" title="clear the craft queue" onClick={() => setCraftQueue([])}>✕</button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Campfire: queue raw food, watch it cook */}
      {station === 'firepit' && inv && (() => {
        const rawSlots = inv.inv.slots
          .map((s, i) => ({ s, i }))
          .filter((x): x is { s: { id: ItemId; qty: number }; i: number } => !!x.s && !!ITEMS[x.s.id].raw);
        const cookingSlot = action?.kind === 'cook' ? action.slot : undefined;
        return (
          <div className="panel cook-panel">
            <h3>CAMPFIRE<span className="sub">ESC to close</span></h3>
            {rawSlots.length === 0 ? (
              <div className="item-desc">Nothing raw to cook — hunt animals or catch fish, then come back.</div>
            ) : (
              <div className="cook-list">
                {rawSlots.map(({ s, i }) => {
                  const def = ITEMS[s.id];
                  const cooking = cookingSlot === i;
                  const queuePos = cookQueue.indexOf(i);
                  return (
                    <button
                      key={i}
                      className={`cook-row${cooking ? ' cooking' : ''}${queuePos >= 0 ? ' queued' : ''}`}
                      onClick={() => setCookQueue((q) => (q.includes(i) ? q : [...q, i]))}
                    >
                      <ItemIcon id={s.id} size={28} />
                      <span className="cook-name">{def.name} ×{s.qty}</span>
                      <span className="cook-arrow">→</span>
                      <ItemIcon id={def.raw!} size={22} />
                      {cooking && action && (
                        <span className="cook-prog">
                          <span key={action.until} style={{ animationDuration: `${action.ms}ms` }} />
                        </span>
                      )}
                      {!cooking && queuePos >= 0 && <span className="queue-badge">{queuePos + 1}</span>}
                      {!cooking && queuePos < 0 && <span className="cook-hint">COOK</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="item-actions">
              {rawSlots.length > 0 && (
                <button onClick={() => setCookQueue(rawSlots.map(({ i }) => i))}>
                  {cookQueue.length > 0 ? `COOKING… (${cookQueue.length})` : 'COOK EVERYTHING'}
                </button>
              )}
              <button onClick={() => { setCookQueue([]); setStation(null); }}>CLOSE</button>
            </div>
          </div>
        );
      })()}

      {/* starter objectives checklist */}
      {connected && !dead && !objectives.celebrated && !panelsOpenRef.current && (
        <div className="objectives">
          <div className="obj-title">OBJECTIVES</div>
          {OBJECTIVES.map((o) => (
            <div key={o.id} className={`obj-row${objectives[o.id] ? ' done' : ''}`}>
              {objectives[o.id] ? '☑' : '☐'} {o.label}
            </div>
          ))}
        </div>
      )}

      {/* Skills */}
      {showSkills && inv && (
        <div className="panel skills-panel">
          <h3>SKILLS<span className="sub">K to close</span></h3>
          {SKILL_LIST.map((s) => {
            const xp = inv.skills[s.id] ?? 0;
            const lvl = skillLevel(xp);
            const cur = xpForLevel(lvl);
            const next = xpForLevel(lvl + 1);
            const pct = lvl >= 50 ? 100 : Math.round(((xp - cur) / (next - cur)) * 100);
            return (
              <div className="skill-row" key={s.id}>
                <div className="sk-head"><b>{s.name}</b><span className="sk-lvl">LV {lvl}</span></div>
                <div className="sk-bar"><div style={{ width: `${pct}%` }} /></div>
                <div className="sk-bonus">{s.bonus}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Trade + jobs */}
      {trade && inv && (
        <div className="panel trade-panel">
          <h3>TRADER<span className="sub">{trade.money} credits</span></h3>
          {trade.quests.length > 0 && (
            <div className="jobs">
              <div className="trade-head">JOBS</div>
              {trade.quests.map((q) => (
                <div className="job-row" key={q.def.id}>
                  <div className="job-body">
                    <b>{q.def.name}</b>
                    <div className="job-desc">
                      {q.def.desc || (q.def.kind === 'kill' ? `Kill ${q.def.count} ${q.def.target}s` : `Bring ${q.def.count} ${ITEMS[q.def.target as ItemId]?.name ?? q.def.target}`)}
                      {' · '}{q.progress}/{q.def.count}
                      {' · '}reward {q.def.rewardMoney}cr{q.def.rewardItem ? ` + ${ITEMS[q.def.rewardItem].name}` : ''}
                    </div>
                  </div>
                  {q.claimed ? <span className="job-done">DONE</span> : (
                    <button disabled={!q.done} onClick={() => emit(EV.questClaim, { id: q.def.id })}>CLAIM</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="trade-cols">
            <div>
              <div className="trade-head">BUY</div>
              {trade.stock.filter((e) => e.buy > 0).map((e) => (
                <div className="trade-row" key={e.id}>
                  <ItemIcon id={e.id} size={24} />
                  <span className="t-name">{ITEMS[e.id].name}</span>
                  <span className="t-price">{e.buy}cr</span>
                  <button disabled={inv.money < e.buy} onClick={() => emit(EV.tradeBuy, { id: e.id, qty: 1 })}>+1</button>
                  <button disabled={inv.money < e.buy * 5} onClick={() => emit(EV.tradeBuy, { id: e.id, qty: 5 })}>+5</button>
                </div>
              ))}
            </div>
            <div>
              <div className="trade-head">SELL (from backpack)</div>
              {inv.inv.slots.map((s, i) => {
                if (!s) return null;
                const entry = trade.stock.find((e) => e.id === s.id && e.sell > 0);
                if (!entry) return null;
                return (
                  <div className="trade-row" key={i}>
                    <ItemIcon id={s.id} size={24} />
                    <span className="t-name">{ITEMS[s.id].name} ×{s.qty}</span>
                    <span className="t-price">{entry.sell}cr</span>
                    <button onClick={() => emit(EV.tradeSell, { slot: i, qty: 1 })}>-1</button>
                    <button onClick={() => emit(EV.tradeSell, { slot: i, qty: s.qty })}>ALL</button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="item-actions">
            <button onClick={() => setTrade(null)}>CLOSE</button>
          </div>
        </div>
      )}

      {/* Social */}
      {showSocial && (
        <div className="panel social-panel">
          <h3>CONTACTS<span className="sub">P to close</span></h3>
          <div className="friend-add">
            <input placeholder="friend's callsign" value={friendUsername} onChange={(e) => setFriendUsername(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFriend(); e.stopPropagation(); }} />
            <button onClick={addFriend}>ADD</button>
          </div>
          <div className="friend-msg">{friendMsg}</div>
          {friends.length === 0 && <div className="item-desc">No contacts yet. Friends show up green on your map.</div>}
          {friends.map((f) => (
            <div className="friend-row" key={f.id}>
              <span className={`f-dot ${f.status}`} />
              <span className="f-name">{f.name}</span>
              <span className="f-status">{f.status === 'accepted' ? 'ally' : f.incoming ? 'wants to ally' : 'pending'}</span>
              {f.status === 'accepted' && inSafe && !inHideout && (
                <button onClick={() => emit(EV.hideoutEnter, { owner: f.id })}>VISIT CAMP</button>
              )}
              {f.status !== 'accepted' && f.incoming && <button onClick={() => acceptFriend(f.id)}>ACCEPT</button>}
            </div>
          ))}
        </div>
      )}

      {/* Death overlay */}
      {dead && (
        <div className="death-overlay">
          <h2>YOU DIED</h2>
          <p>Killed by {dead}. Your gear was dropped where you fell.</p>
          <p className="death-stats">You respawn with only your fists — stash, credits and skills are safe.</p>
          {inv && <p className="death-stats">☠ {inv.kills} kills · {inv.deaths} deaths · {inv.money} cr</p>}
          <button className="btn-primary" onClick={() => emit(EV.respawn)}>RESPAWN</button>
          <button className="btn-primary secondary" onClick={leave}>LOG OUT</button>
        </div>
      )}
    </div>
  );
}
