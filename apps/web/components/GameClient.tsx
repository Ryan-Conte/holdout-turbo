'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ActionSnap,
  AdminActionPayload,
  AdminPanelState,
  BACKPACKS,
  BUILDABLES,
  BlockUpdate,
  ChatMsg,
  ContainerContents,
  EntityDeathSnap,
  EV,
  FLOOR_TILES,
  HitSnap,
  INTERACT_RANGE,
  InventoryUpdate,
  ItemId,
  KillFeedEntry,
  RecipeCat,
  RuntimeGameplayContent,
  SKILL_LIST,
  StateSnap,
  StationOpen,
  StationFuelUpdate,
  TILE,
  Tile,
  TileUpdate,
  TradeOpen,
  WorldInit,
  decodeByteRuns,
  decodeTerrainRuns,
  invCapacity,
  invWeight,
  isNight,
  skillLevel,
  useVerb,
} from '@holdout/shared';
import { DamageFloat, RenderEnemy, RenderPlayer, Renderer } from '@/game/renderer';
import { Tip, itemTip } from '@/components/Tooltip';
import { loadSheets } from '@/game/sprites';
import { initSfx, isMuted, sfx, startAmbient, toggleMute } from '@/game/sfx';
import { authClient } from '@/lib/auth-client';
import { CookingPanel } from '@/components/game/CookingPanel';
import { CraftingPanel } from '@/components/game/CraftingPanel';
import { ItemIcon } from '@/components/game/ItemIcon';
import { SkillsPanel } from '@/components/game/SkillsPanel';
import { ClanInvitation, ClanSummary, FriendContact, SocialPanel } from '@/components/game/SocialPanel';
import { DeathOverlay, PauseOverlay } from '@/components/game/SystemOverlays';
import { TradePanel, TradeTab } from '@/components/game/TradePanel';
import { WORLD_MAP_DEFAULT_ZOOM, WORLD_MAP_SIZE, WorldMapIcon, WorldMapOverlay, type WorldMapViewport } from '@/components/game/WorldMapOverlay';
import { AdminPanel } from '@/components/game/AdminPanel';
import { applyRuntimeGameplay, itemDef, runtimeItems, runtimeRecipes } from '@/lib/runtime-gameplay';
import { applyRuntimeVisuals } from '@/lib/runtime-visuals';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
/** the server picked in the login-screen server browser (falls back to env) */
function gameServerUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get('server') || localStorage.getItem('holdout_server_url') || API_URL;
  } catch {
    return API_URL;
  }
}
const MINIMAP_SIZE = 168;
const MINIMAP_VISIBLE_TILES = 72;

interface Toast { id: number; msg: string }
interface FloatRec { x: number; y: number; amount: number; kind: DamageFloat['kind']; label?: string; at: number }
const SKILL_ABBR: Record<string, string> = { woodcutting: 'WC', mining: 'MIN', shooting: 'SHT', melee: 'MEL', crafting: 'CRF' };
// outfit swatch colors — mirror the survivor shirt rows in tools/gen-sprites.mjs

// starter objectives — gives new players a direction (tracked locally, once done stays done)
const OBJECTIVES: { id: string; label: string }[] = [
  { id: 'deploy', label: 'Deploy via the door mat (E)' },
  { id: 'wood', label: 'Collect wood from a tree' },
  { id: 'spear', label: 'Craft a Wooden Spear (C)' },
  { id: 'kill', label: 'Make your first kill' },
  { id: 'extract', label: 'Extract safely at a beacon' },
  { id: 'trade', label: 'Meet an outpost trader' },
  { id: 'cook', label: 'Cook a meal at a firepit' },
  { id: 'build', label: 'Build something at home (B)' },
];

// tiles a player can reclaim in their own camp (built chests sit on grass, handled separately)
const DEMOLISHABLE = new Set<number>([
  Tile.WoodFloor, Tile.StoneFloor, Tile.WoodWall, Tile.Door, Tile.Fence, Tile.Torch,
  Tile.Workbench, Tile.Firepit, Tile.Furnace, Tile.Anvil, Tile.Bed,
]);

type DragZone = 'inv' | 'cont' | 'helmet' | 'vest' | 'mod' | 'weapon';
interface DragState { zone: DragZone; index: number; item: ItemId; qty: number }
interface CtxMenu { x: number; y: number; zone: DragZone; index: number; item: ItemId; qty: number }

export default function GameClient() {
  const router = useRouter();
  const guestRequested = useRef<boolean>((() => {
    try { return new URLSearchParams(window.location.search).get('guest') === '1'; } catch { return false; }
  })()).current;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const worldMapRef = useRef<HTMLCanvasElement>(null);
  const worldMapViewRef = useRef<WorldMapViewport>({ centerX: 0, centerY: 0, zoom: WORLD_MAP_DEFAULT_ZOOM });
  const socketRef = useRef<Socket | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const snapRef = useRef<StateSnap | null>(null);
  const initRef = useRef<WorldInit | null>(null);
  const youRef = useRef<string>('');
  const displayPos = useRef(new Map<string, { x: number; y: number }>());
  const keys = useRef({ up: false, down: false, left: false, right: false });
  const sprintRef = useRef(false);
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
  const clanNamesRef = useRef(new Set<string>());
  const latestInvRef = useRef<InventoryUpdate | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragConsumed = useRef(false);
  const justDragged = useRef(false); // set on a real drag so the trailing onClick is ignored
  const lastStepAt = useRef(0);
  const lastGroanAt = useRef(0);
  const heldKitRef = useRef<{ slot: number; item: ItemId } | null>(null); // equipped placeable = placement mode
  const buildRotationRef = useRef(0);
  const chatOpenRef = useRef(false);
  const menuRef = useRef({ gear: false, craft: false, skills: false, social: false, map: false, admin: false });
  const lootContRef = useRef<string | null>(null); // container the loot queue belongs to
  const lootAwaitRef = useRef<{ slot: number; at: number } | null>(null); // fired, waiting on server
  const cookAwaitRef = useRef<{ slot: number; at: number } | null>(null);
  const craftAwaitRef = useRef<number | null>(null);
  const prevSkillsRef = useRef<InventoryUpdate['skills'] | null>(null);
  const promptPosRef = useRef<{ x: number; y: number } | null>(null);
  const clockRef = useRef('');
  const lastHowlAt = useRef(0);
  const lastGruntAt = useRef(0);
  const prevOverRef = useRef(false);
  const demolishRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState('');
  const [, setGameplayRevision] = useState('fallback');
  const [inv, setInv] = useState<InventoryUpdate | null>(null);
  const [showGear, setShowGear] = useState(false);
  const [showCraft, setShowCraft] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuest, setIsGuest] = useState(guestRequested);
  const [adminPanel, setAdminPanel] = useState<AdminPanelState | null>(null);
  const [worldMapView, setWorldMapView] = useState<WorldMapViewport>(worldMapViewRef.current);
  const [craftTab, setCraftTab] = useState<RecipeCat>('survival');
  const [craftSel, setCraftSel] = useState<string | null>(null);
  const [container, setContainer] = useState<ContainerContents | null>(null);
  const [trade, setTrade] = useState<TradeOpen | null>(null);
  const [tradeTab, setTradeTab] = useState<TradeTab>('buy');
  const [buySel, setBuySel] = useState<ItemId | null>(null);
  const [sellSel, setSellSel] = useState<number | null>(null); // backpack slot index
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [feed, setFeed] = useState<(KillFeedEntry & { id: number })[]>([]);
  const [dead, setDead] = useState<string | null>(null);
  const [online, setOnline] = useState(0);
  const [location, setLocation] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [inSafe, setInSafe] = useState(false);
  const [inHideout, setInHideout] = useState(false);
  const [ownHideout, setOwnHideout] = useState(false);
  const [canDemolishHideout, setCanDemolishHideout] = useState(false);
  const [hurtAt, setHurtAt] = useState(0);
  const [muted, setMuted] = useState(false);
  const [friends, setFriends] = useState<FriendContact[]>([]);
  const [friendUsername, setFriendUsername] = useState('');
  const [friendMsg, setFriendMsg] = useState('');
  const [clan, setClan] = useState<ClanSummary | null>(null);
  const [clanInvitations, setClanInvitations] = useState<ClanInvitation[]>([]);
  const [clanName, setClanName] = useState('');
  const [clanTag, setClanTag] = useState('');
  const [clanUsername, setClanUsername] = useState('');
  const [clanMsg, setClanMsg] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatLog, setChatLog] = useState<(ChatMsg & { at: number })[]>([]);
  const [action, setAction] = useState<{ label: string; until: number; ms: number; kind?: string; container?: string; slot?: number } | null>(null);
  const [lootQueue, setLootQueue] = useState<number[]>([]); // container slots queued for taking
  const [cookQueue, setCookQueue] = useState<number[]>([]); // inventory slots queued for cooking
  const [craftQueue, setCraftQueue] = useState<string[]>([]); // recipe ids queued for crafting
  const [station, setStation] = useState<StationOpen | null>(null);
  const [clock, setClock] = useState('');
  const [demolishMode, setDemolishMode] = useState(false); // camp demolish mode (X)
  const [buildRotation, setBuildRotation] = useState(0);
  const [escMenu, setEscMenu] = useState(false); // pause/system menu (ESC)
  const [objectives, setObjectives] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('holdout_objectives') ?? '{}'); } catch { return {}; }
  });
  const chatInputRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const rotateBuild = useCallback(() => {
    if (!heldKitRef.current) return;
    const next = (buildRotationRef.current + 1) % 4;
    buildRotationRef.current = next;
    setBuildRotation(next);
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
  useEffect(() => {
    latestInvRef.current = inv;
    // holding a build kit in hand = placement mode (ghost + click-to-place)
    const s = inv?.equipped !== null && inv?.equipped !== undefined ? inv.inv.slots[inv.equipped] : null;
    const next = s && itemDef(s.id).place ? { slot: inv!.equipped!, item: s.id } : null;
    if (heldKitRef.current?.item !== next?.item) {
      buildRotationRef.current = 0;
      setBuildRotation(0);
    }
    heldKitRef.current = next;
  }, [inv]);
  useEffect(() => { demolishRef.current = demolishMode; }, [demolishMode]);
  const escMenuRef = useRef(false);
  useEffect(() => { escMenuRef.current = escMenu; }, [escMenu]);
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
    if (!next.spear && has('spear')) next.spear = true;
    if (!next.kill && inv.kills > 0) next.kill = true;
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

  // Cook queue: every entry is ONE cook of that slot (click = +1). Entries are
  // popped as they fire so a stuck server action can never wedge the queue.
  useEffect(() => {
    if (action) { cookAwaitRef.current = null; return; }
    if (cookQueue.length === 0) return;
    const aw = cookAwaitRef.current;
    if (aw && Date.now() - aw.at < 900) {
      // fired but the action hasn't arrived (or was rejected) — re-check shortly
      const t = setTimeout(() => setCookQueue((q) => [...q]), 950);
      return () => clearTimeout(t);
    }
    const slots = inv?.inv.slots;
    if (!slots || !inv?.nearFirepit || station?.type !== 'firepit' || (station.fuel ?? 0) <= 0) { setCookQueue([]); return; }
    const i = cookQueue[0];
    setCookQueue((q) => q.slice(1));
    const s = slots[i];
    if (!s || !itemDef(s.id).raw) return; // stack moved or finished — skip this entry
    cookAwaitRef.current = { slot: i, at: Date.now() };
    socketRef.current?.emit(EV.invUse, { slot: i });
  }, [action, inv, cookQueue, station]);
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
    const r = runtimeRecipes().find((x) => x.id === id);
    const have = (iid: string) => inv?.inv.slots.reduce((n, s) => n + (s && s.id === iid ? s.qty : 0), 0) ?? 0;
    if (!r || !r.cost.every((c) => have(c.id) >= c.qty) || (r.station === 'furnace' && (station?.fuel ?? 0) <= 0)) return; // can no longer pay or fuel it — skip
    craftAwaitRef.current = Date.now();
    socketRef.current?.emit(EV.craft, { recipe: id });
  }, [action, craftQueue, inv, station]);

  // if you walk away from a station while its exclusive craft tab is open, fall back
  useEffect(() => {
    if (!inv) return;
    const away = (craftTab === 'smelt' && !inv.nearFurnace) || (craftTab === 'forge' && !inv.nearAnvil);
    if (away) setCraftTab('survival');
  }, [inv, craftTab]);

  useEffect(() => {
    menuRef.current = { gear: showGear, craft: showCraft, skills: showSkills, social: showSocial, map: showMap, admin: showAdmin };
  }, [showGear, showCraft, showSkills, showSocial, showMap, showAdmin]);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) chatInputRef.current?.focus(); }, [chatOpen]);

  const updateWorldMapView = useCallback((next: WorldMapViewport) => {
    worldMapViewRef.current = next;
    setWorldMapView(next);
  }, []);

  const getMapPlayerPosition = useCallback(() => {
    const id = youRef.current;
    const displayed = displayPos.current.get(id);
    if (displayed) return { x: displayed.x / TILE, y: displayed.y / TILE };
    const player = snapRef.current?.players.find((entry) => entry.id === id);
    return player ? { x: player.x / TILE, y: player.y / TILE } : null;
  }, []);

  // exactly one full-screen menu open at a time (no stacking)
  const only = useCallback((which: 'gear' | 'craft' | 'skills' | 'social' | 'map' | 'admin' | null) => {
    if (which === 'map') {
      const player = getMapPlayerPosition();
      if (player) updateWorldMapView({ ...worldMapViewRef.current, centerX: player.x, centerY: player.y });
    }
    setShowGear(which === 'gear');
    setShowCraft(which === 'craft');
    setShowSkills(which === 'skills');
    setShowSocial(which === 'social');
    setShowMap(which === 'map');
    setShowAdmin(which === 'admin');
    if (which === 'admin') {
      setAdminPanel(null);
      socketRef.current?.emit(EV.adminRequest);
    }
    setTrade(null);
    setStation(null);
    if (which !== 'gear') { setContainer(null); socketRef.current?.emit(EV.containerClose); }
    if (which !== null) setDemolishMode(false);
    setEscMenu(false);
  }, [getMapPlayerPosition, updateWorldMapView]);

  // no build mode: holding a kit IS placement — equip it, ghost follows, click places
  const holdKit = useCallback((slot: number) => {
    only(null);
    setCtxMenu(null);
    setDemolishMode(false);
    const u = latestInvRef.current;
    if (u?.equipped !== slot) socketRef.current?.emit(EV.invEquip, { slot });
    pushToast('Holding the kit — click the ground to place');
  }, [only, pushToast]);

  const toggleDemolish = useCallback(() => {
    if (!initRef.current?.canDemolish) {
      pushToast(initRef.current?.kind === 'clan_hideout' ? 'Only clan officers and the owner can demolish here' : 'Demolish only works in your own camp');
      return;
    }
    only(null);
    setDemolishMode((d) => !d);
  }, [only, pushToast]);

  // selecting a hotbar slot: weapons/tools/food/kits get held in hand
  // (click to use/attack/place); armor/mods/backpacks apply immediately
  const useSlot = useCallback((i: number) => {
    const s = latestInvRef.current?.inv.slots[i];
    if (!s) return;
    const def = itemDef(s.id);
    const kind = def.kind;
    if (kind === 'weapon' || kind === 'tool' || kind === 'consumable' || kind === 'placeable')
      socketRef.current?.emit(EV.invEquip, { slot: i });
    else socketRef.current?.emit(EV.invUse, { slot: i });
  }, []);

  // scroll wheel cycles the equipped weapon/tool across hotbar slots 1-5
  const cycleHotbar = useCallback((dir: number) => {
    const u = latestInvRef.current;
    if (!u) return;
    const cand: number[] = [];
    for (let i = 0; i < 5 && i < u.inv.slots.length; i++) {
      const s = u.inv.slots[i];
      const k = s && itemDef(s.id).kind;
      if (k === 'weapon' || k === 'tool' || k === 'consumable' || k === 'placeable') cand.push(i);
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
    if (guestRequested) return;
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) return;
      const data = await res.json();
      setFriends(data.friends ?? []);
      friendNamesRef.current = new Set(
        (data.friends ?? [])
          .filter((friend: FriendContact) => friend.status === 'accepted')
          .map((friend: FriendContact) => friend.name),
      );
    } catch { /* offline is fine */ }
  }, [guestRequested]);

  const refreshClans = useCallback(async () => {
    if (guestRequested) return;
    try {
      const response = await fetch('/api/clans');
      if (!response.ok) return;
      const data = await response.json();
      setClan(data.clan ?? null);
      setClanInvitations(data.invitations ?? []);
      clanNamesRef.current = new Set((data.clan?.members ?? []).map((member: { name: string }) => member.name));
    } catch { /* offline is fine */ }
  }, [guestRequested]);

  const refreshCommunity = useCallback(() => {
    if (guestRequested) return;
    void refreshFriends();
    void refreshClans();
    socketRef.current?.emit(EV.socialRefresh);
  }, [guestRequested, refreshClans, refreshFriends]);

  useEffect(() => { refreshCommunity(); }, [refreshCommunity]);

  // ── socket lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      const selectedServerUrl = gameServerUrl();
      const res = await fetch('/api/game-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serverUrl: selectedServerUrl, guest: guestRequested }),
      });
      if (res.status === 401) {
        router.replace('/');
        return;
      }
      if (!res.ok) {
        const failure = await res.json().catch(() => ({})) as { error?: string };
        setFailed(failure.error || 'Could not get a game session token.');
        return;
      }
      const { token } = await res.json();
      const sheets = await loadSheets();
      if (cancelled) return;

      socket = io(selectedServerUrl, { auth: { token }, transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect_error', () => setFailed('Cannot reach the selected game server. Return to deployment to choose another relay, or retry.'));
      socket.on('disconnect', () => setConnected(false));
      socket.on(EV.init, (init: WorldInit) => {
        youRef.current = init.you;
        initRef.current = init;
        setIsGuest(init.guest === true);
        setIsAdmin(init.admin === true);
        if (!init.admin) {
          setShowAdmin(false);
          setAdminPanel(null);
        }
        applyRuntimeGameplay(init.gameplay);
        setGameplayRevision(init.gameplay?.version ?? 'fallback');
        const visuals = init.visuals ?? { assets: {}, animations: {}, resources: {}, sounds: { presets: {}, actions: {} }, mobSounds: {}, blocks: {}, terrain: {} };
        applyRuntimeVisuals(visuals);
        const cellCount = init.width * init.height;
        const tiles = init.tiles.length === cellCount ? Uint8Array.from(init.tiles) : decodeByteRuns(init.tileRuns, cellCount, Tile.Grass);
        const elevations = init.elevations.length === cellCount ? Uint8Array.from(init.elevations) : decodeByteRuns(init.elevationRuns, cellCount, 0);
        sfx.applyContent(visuals.sounds);
        const terrainKinds = { ...decodeTerrainRuns(init.terrainRuns, cellCount), ...(init.terrainKinds ?? {}) };
        rendererRef.current = new Renderer(tiles, init.width, init.height, sheets, init.pois, init.traders, init.exit, init.extracts ?? [], init.unders ?? {}, elevations, visuals, terrainKinds, init.resourceKinds ?? {}, init.blockKinds ?? {}, init.blockRotations ?? {}, init.openDoors ?? [], init.stationFuel ?? {}, init.gameplay, (soundId, volume) => sfx.play(soundId, volume));
        updateWorldMapView({ centerX: init.width / 2, centerY: init.height / 2, zoom: WORLD_MAP_DEFAULT_ZOOM });
        displayPos.current.clear();
        seenProjectiles.current.clear();
        snapRef.current = null;
        setInHideout(init.kind !== 'world');
        setOwnHideout(init.ownHideout);
        setCanDemolishHideout(init.canDemolish);
        setDemolishMode(false);
        setStation(null);
        setContainer(null);
        setTrade(null);
        setConnected(true);
        setFailed('');
        setLocation(init.kind !== 'world' ? init.name : null);
        locationRef.current = init.kind !== 'world' ? init.name : null;
        if (init.kind === 'world') completeObjective('deploy');
      });
      socket.on(EV.gameplay, (gameplay: RuntimeGameplayContent) => {
        applyRuntimeGameplay(gameplay);
        rendererRef.current?.applyGameplay(gameplay);
        setGameplayRevision(gameplay.version);
        setCraftSel(null);
        setCraftQueue([]);
      });
      socket.on(EV.visuals, (visuals) => {
        applyRuntimeVisuals(visuals);
        sfx.applyContent(visuals.sounds);
        rendererRef.current?.applyVisuals(visuals);
        setGameplayRevision((revision) => `${revision}:v`);
      });
      socket.on(EV.entityDeath, (death: EntityDeathSnap) => rendererRef.current?.entityDeath(death));
      socket.on(EV.state, (s: StateSnap) => {
        snapRef.current = s;
        setOnline(s.population ?? s.players.length);
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
            if (e.kind !== 'boar' && e.kind !== 'bear') continue;
            const d = Math.hypot(e.x - you.x, e.y - you.y);
            const range = e.kind === 'bear' ? 340 : 220;
            if (d < range && Math.random() < 0.4) {
              sfx.grunt(Math.max(0.2, 1 - d / (range + 40)));
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
        // overweight warning — once per transition, not a nag
        const over = invWeight(u.inv, runtimeItems()) > invCapacity(u.inv).maxKg;
        if (over && !prevOverRef.current) pushToast('⚠ OVERWEIGHT — you move at a crawl. Drop or stash something.');
        prevOverRef.current = over;
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
          setStation(s);
        } else if (s.type === 'furnace') {
          setCraftTab('smelt');
          only('craft');
          setStation(s);
        } else if (s.type === 'workbench') {
          setCraftTab('survival');
          only('craft');
          setStation(s);
        } else if (s.type === 'anvil') {
          setCraftTab('forge');
          only('craft');
          setStation(s);
        }
      });
      socket.on(EV.toast, (msg: string) => {
        pushToast(msg);
        if (msg.startsWith('Picked up')) sfx.pickup();
        else if (msg.startsWith('Crafted') || msg.startsWith('Meal ready:') || msg.startsWith('Placed') || msg.startsWith('Bought') || msg.startsWith('Sold') || msg.startsWith('Job complete')) sfx.craft();
        if (msg.startsWith('Crafted Wooden Spear')) completeObjective('spear');
        if (msg.startsWith('Meal ready:')) completeObjective('cook');
        if (msg.startsWith('Placed')) completeObjective('build');
        if (msg.startsWith('Extraction successful')) completeObjective('extract');
      });
      socket.on(EV.hit, (h: HitSnap) => {
        floatsRef.current.push({ x: h.x, y: h.y, amount: h.amount, kind: h.kind, at: performance.now() });
        rendererRef.current?.hitFx(h);
        const you = snapRef.current?.players.find((p) => p.id === youRef.current);
        const d = you ? Math.hypot(h.x - you.x, h.y - you.y) : 9999;
        if (d < 350) {
          if (h.kind === 'node') h.soundId ? sfx.play(h.soundId, Math.max(0.2, 1 - d / 380)) : sfx.chop(Math.max(0.2, 1 - d / 380));
          else sfx.hit(Math.max(0.2, 1 - d / 380));
        }
      });
      socket.on(EV.tile, (u: TileUpdate) => rendererRef.current?.applyTile(u.i, u.tile, u.under, u.resourceId));
      socket.on(EV.block, (update: BlockUpdate) => rendererRef.current?.applyBlock(update.i, update.blockId, update.rotation, update.open));
      socket.on(EV.stationFuelUpdate, (update: StationFuelUpdate) => rendererRef.current?.applyStationFuel(update.i, update.fuel));
      socket.on(EV.clanTreasuryUpdate, (update: { clanId: string; treasury: number; actor: string; amount: number }) => {
        setClan((current) => current?.id === update.clanId ? { ...current, treasury: update.treasury } : current);
        setClanMsg(update.amount > 0
          ? `${update.actor} contributed ${update.amount.toLocaleString()} credits`
          : `${update.actor} withdrew ${Math.abs(update.amount).toLocaleString()} credits`);
        void refreshClans();
      });
      socket.on(EV.adminState, (state: AdminPanelState) => {
        setIsAdmin(true);
        setAdminPanel(state);
      });
      socket.on(EV.action, (a: ActionSnap) => {
        setAction(a.ms > 0 ? { label: a.label, until: Date.now() + a.ms, ms: a.ms, kind: a.kind, container: a.container, slot: a.slot } : null);
      });
      socket.on(EV.chatMsg, (m: ChatMsg) => {
        if (m.channel !== 'clan') bubblesRef.current.set(m.id, { text: m.text, at: performance.now() });
        setChatLog((log) => [...log.slice(-5), { ...m, at: Date.now() }]);
      });
      socket.on(EV.killfeed, (k: KillFeedEntry) => {
        const id = Date.now() + Math.random();
        setFeed((f) => [...f.slice(-4), { ...k, id }]);
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 7000);
      });
      socket.on(EV.death, (d: { by: string }) => {
        only(null);
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
  }, [router, pushToast, only, completeObjective, updateWorldMapView, refreshClans]);

  useEffect(() => {
    panelsOpenRef.current = showGear || showCraft || showSocial || showSkills || showMap || showAdmin || !!container || !!trade || chatOpen || !!ctxMenu || !!station || escMenu;
  }, [showGear, showCraft, showSocial, showSkills, showMap, showAdmin, container, trade, chatOpen, ctxMenu, station, escMenu]);

  // ── actions ─────────────────────────────────────────────────────────────
  const emit = useCallback((ev: string, payload?: unknown) => socketRef.current?.emit(ev, payload), []);
  const adminAction = useCallback((action: AdminActionPayload) => emit(EV.adminAction, action), [emit]);

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
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') sprintRef.current = true;
      else if (e.code === 'KeyE') emit(EV.interact);
      else if (e.code === 'KeyR') { if (heldKitRef.current) rotateBuild(); else emit(EV.reload); }
      else if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); only(menuRef.current.gear ? null : 'gear'); }
      else if (e.code === 'KeyC') only(menuRef.current.craft ? null : 'craft');
      else if (e.code === 'KeyK') only(menuRef.current.skills ? null : 'skills');
      else if (e.code === 'KeyP' && !isGuest) { only(menuRef.current.social ? null : 'social'); refreshCommunity(); }
      else if (e.code === 'F10' && isAdmin) { e.preventDefault(); only(menuRef.current.admin ? null : 'admin'); }
      else if (e.code === 'KeyQ') quickHeal();
      else if (e.code === 'KeyB') {
        // grab the first build kit you own into your hand
        const u = latestInvRef.current;
        const s = u?.inv.slots.findIndex((x) => x && itemDef(x.id).place) ?? -1;
        if (u && s >= 0) holdKit(s);
        else pushToast('Craft a build kit first (C → BUILD)');
      }
      else if (e.code === 'KeyX') toggleDemolish();
      else if (e.code === 'KeyM' && initRef.current) { e.preventDefault(); only(menuRef.current.map ? null : 'map'); }
      else if (!isGuest && (e.code === 'Enter' || e.code === 'KeyT')) { e.preventDefault(); setChatOpen(true); }
      else if (/^Digit[1-5]$/.test(e.code)) useSlot(Number(e.code.slice(5)) - 1);
      else if (e.code === 'Escape') {
        if (escMenuRef.current) {
          setEscMenu(false);
        } else if (panelsOpenRef.current || demolishRef.current) {
          only(null);
          setCtxMenu(null);
          setDemolishMode(false);
        } else {
          setEscMenu(true); // nothing open — bring up the system menu
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyMap[e.code]) keys.current[keyMap[e.code]] = false;
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') sprintRef.current = false;
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
      // holding a build kit: click the ground to place it (no separate build mode)
      const pl = heldKitRef.current;
      if (pl && snapRef.current) {
        const you = snapRef.current.players.find((p) => p.id === youRef.current);
        if (you) {
          const wx = you.x + (e.clientX - window.innerWidth / 2) / 2; // zoom = 2
          const wy = you.y + (e.clientY - window.innerHeight / 2) / 2;
          emit(EV.build, { slot: pl.slot, tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE), rotation: buildRotationRef.current });
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
      sprintRef.current = false;
      mouse.current.down = false;
    };
    const onWheel = (e: WheelEvent) => {
      // let panels (crafting grid, stash) scroll normally; only steer the hotbar in-world
      if (panelsOpenRef.current || demolishRef.current) return;
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
  }, [emit, quickHeal, toggleDemolish, refreshCommunity, pushToast, only, holdKit, rotateBuild, useSlot, cycleHotbar, isAdmin, isGuest]);

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
        shoot: mouse.current.down && !locked && !heldKitRef.current && !demolishRef.current,
        sprint: sprintRef.current && !locked,
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
      let ghost: { tile: number; blockId?: string; rotation: number; tx: number; ty: number; valid: boolean } | null = null;
      const pl = heldKitRef.current;
      if (pl && meNow) {
        const wx = meNow.dx + (mouse.current.x - canvas.width / 2) / renderer.zoom;
        const wy = meNow.dy + (mouse.current.y - canvas.height / 2) / renderer.zoom;
        const tx = Math.floor(wx / TILE);
        const ty = Math.floor(wy / TILE);
        const bt = itemDef(pl.item).place;
        const tile = bt ? (BUILDABLES[bt].tile ?? -1) : -1;
        const inRange = Math.hypot((tx + 0.5) * TILE - meNow.dx, (ty + 0.5) * TILE - meNow.dy) <= TILE * 4;
        const under = renderer.tileAtPublic(tx, ty);
        // floors need grass; everything else can also go on top of flooring
        const isFloorKit = bt === 'wood_floor' || bt === 'stone_floor';
        const groundOk = isFloorKit ? under === Tile.Grass : under === Tile.Grass || !!FLOOR_TILES[under];
        const blockOk = !renderer.hasBlockAtPublic(tx, ty) || (!isFloorKit && renderer.blockIsFoundationAtPublic(tx, ty));
        const containerOk = !snap.containers.some((entry) => Math.floor(entry.x / TILE) === tx && Math.floor(entry.y / TILE) === ty);
        ghost = { tile, blockId: bt ? renderer.playerBlockId(bt) : undefined, rotation: buildRotationRef.current, tx, ty, valid: inRange && groundOk && blockOk && containerOk };
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
        const builtBlock = renderer.blockBuildTypeAtPublic(tx, ty);
        demolish = { tx, ty, valid: inRange && (DEMOLISHABLE.has(renderer.tileAtPublic(tx, ty)) || Boolean(builtBlock) || builtChest) };
      }

      // world-space aim point for the drawn crosshair
      const cursor = meNow && !panelsOpenRef.current
        ? {
            x: meNow.dx + (mouse.current.x - canvas.width / 2) / renderer.zoom,
            y: meNow.dy + (mouse.current.y - canvas.height / 2) / renderer.zoom,
          }
        : null;

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
        fog: init.kind === 'world', // walls hide what the server hides — show it
        cursor,
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
      const visibleMapIds = new Set(players.map((player) => player.id));
      const tacticalPlayers = [
        ...players,
        ...(snap.mapPlayers ?? []).filter((player) => !visibleMapIds.has(player.id)).map((player) => ({
          id: player.id,
          name: player.name,
          dx: player.x,
          dy: player.y,
          dead: false,
        })),
      ];
      const tacticalFriendNames = new Set(friendNamesRef.current);
      const tacticalClanNames = new Set(clanNamesRef.current);
      for (const player of snap.mapPlayers ?? []) {
        if (player.relation === 'clan') tacticalClanNames.add(player.name);
        else tacticalFriendNames.add(player.name);
      }
      const mapView = {
        pois: init.pois,
        players: tacticalPlayers,
        youId: youRef.current,
        friendNames: tacticalFriendNames,
        clanNames: tacticalClanNames,
      };
      if (mm && you) {
        renderer.drawMinimap(mm.getContext('2d')!, MINIMAP_SIZE, mapView, {
          centerX: you.dx / TILE,
          centerY: you.dy / TILE,
          visibleTiles: MINIMAP_VISIBLE_TILES,
          clampToMap: false,
        });
      }
      const fullMap = worldMapRef.current;
      if (fullMap && you) {
        renderer.drawMinimap(fullMap.getContext('2d')!, WORLD_MAP_SIZE, mapView, {
          detailed: true,
          ...worldMapViewRef.current,
        });
      }

      if (you) {
        let loc: string | null = init.kind !== 'world' ? init.name : null;
        let safe = init.kind !== 'world';
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
        if (init.kind !== 'world' && init.exit) {
          const d = Math.hypot(init.exit.x - you.dx, init.exit.y - you.dy);
          if (d < bestD) { bestD = d; bestPrompt = init.kind === 'clan_hideout' ? 'Return from clan holdout' : 'Deploy into the zone'; bestPos = init.exit; }
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
              const blockType = renderer.blockBuildTypeAtPublic(tx2, ty2);
              const label =
                t === Tile.Firepit || blockType === 'firepit' ? 'Cook at the campfire'
                : t === Tile.Furnace || blockType === 'furnace' ? 'Use furnace (smelt ore)'
                : t === Tile.Workbench || blockType === 'workbench' ? 'Use workbench (craft)'
                : t === Tile.Anvil || blockType === 'anvil' ? 'Use anvil (forge weapons)'
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
            bestPrompt = `Pick up ${itemDef(g.item).name}${g.qty > 1 ? ` ×${g.qty}` : ''}`;
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
    justDragged.current = false;
    dragRef.current = { zone, index, item, qty };
    setDrag(dragRef.current);
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  const dropOn = (zone: DragZone, index: number) => {
    const d = dragRef.current;
    if (!d) return;
    // did the pointer actually move? a plain click (no drag) is handled by onClick instead
    const moved = Math.hypot(mouse.current.x - dragStart.current.x, mouse.current.y - dragStart.current.y) > 6;
    const sameSpot = d.zone === zone && d.index === index;
    if (!moved || sameSpot) { dragRef.current = null; setDrag(null); return; }
    dragConsumed.current = true;
    justDragged.current = true; // suppress the click that follows this mouseup
    const cont = containerRef.current;
    if (d.zone === 'inv') {
      if (zone === 'inv' && index !== d.index) emit(EV.invMove, { from: d.index, to: index });
      else if (zone === 'cont' && cont) {
        emit(EV.containerPut, { id: cont.id, slot: d.index, target: index }); // drop onto this exact slot
      } else if (zone === 'weapon') {
        const kind = itemDef(d.item).kind;
        if (kind === 'weapon' || kind === 'tool') emit(EV.invEquip, { slot: d.index });
        else pushToast('That is not a weapon');
      } else if (zone === 'helmet' || zone === 'vest' || zone === 'mod') {
        const def = itemDef(d.item);
        const fits = (zone === 'mod' && def.kind === 'mod') || (def.armor && def.armor.piece === zone);
        if (fits) emit(EV.invUse, { slot: d.index });
        else pushToast(`That does not fit the ${zone.toUpperCase()} slot`);
      }
    } else if (d.zone === 'cont' && cont) {
      if (zone === 'cont') emit(EV.containerMove, { id: cont.id, from: d.index, to: index }); // reorder inside the chest
      else enqueueLoot(d.index); // dragged out to your backpack — take it
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
      case 'place': holdKit(m.index); break;
      case 'unequip': emit(EV.unequipArmor, { piece: m.zone }); break;
      case 'drop1': emit(EV.invDrop, { slot: m.index, qty: 1 }); break;
      case 'dropall': emit(EV.invDrop, { slot: m.index, qty: m.qty }); break;
      case 'store': if (cont) emit(EV.containerPut, { id: cont.id, slot: m.index }); break;
      case 'take': if (cont) enqueueLoot(m.index); break;
      case 'repair': emit(EV.repair, { slot: m.index }); break;
    }
  };

  const countOf = (id: string) => inv?.inv.slots.reduce((n, s) => n + (s && s.id === id ? s.qty : 0), 0) ?? 0;

  const equippedItem = inv && inv.equipped !== null ? inv.inv.slots[inv.equipped] : null;
  const eqWeapon = equippedItem ? itemDef(equippedItem.id).weapon : null;
  const heldKit = equippedItem && itemDef(equippedItem.id).place ? { slot: inv!.equipped!, item: equippedItem.id, qty: equippedItem.qty } : null;
  const anyPanel = showGear || showCraft || showSkills || showSocial || showMap || showAdmin || !!container || !!trade || chatOpen || !!station || !!dead || escMenu;
  const ammoReserve = eqWeapon ? countOf(eqWeapon.ammo) : null;
  const weight = inv ? invWeight(inv.inv, runtimeItems()) : 0;
  const cap = inv ? invCapacity(inv.inv) : BACKPACKS[0];
  const trackedJobs = [...(inv?.quests ?? [])]
    .filter((job) => !job.claimed)
    .sort((a, b) => Number(b.done) - Number(a.done) || a.def.tier - b.def.tier || a.def.id - b.def.id)
    .slice(0, 3);

  const leave = async () => {
    socketRef.current?.disconnect();
    if (!isGuest) await authClient.signOut();
    router.push('/');
  };

  // back to the deploy screen without signing out (the socket drops = combat-log rules apply)
  const returnToMenu = () => {
    socketRef.current?.disconnect();
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

  /** remove an ally / cancel an outgoing request / decline an incoming one */
  const removeFriend = async (id: string) => {
    await fetch('/api/friends', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void refreshFriends();
  };

  const clanRequest = async (method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>, success: string) => {
    setClanMsg('');
    const response = await fetch('/api/clans', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    setClanMsg(response.ok ? success : data.error ?? 'Clan action failed');
    if (response.ok) {
      await refreshClans();
      emit(EV.socialRefresh);
    }
    return response.ok;
  };

  const createClan = async () => {
    if (await clanRequest('POST', { action: 'create', name: clanName, tag: clanTag }, 'Clan founded — your shared holdout is ready')) {
      setClanName(''); setClanTag('');
    }
  };

  const inviteClanMember = async () => {
    if (await clanRequest('POST', { action: 'invite', username: clanUsername }, `Invitation sent to ${clanUsername}`)) setClanUsername('');
  };

  const transferClan = async (memberId: string) => {
    const member = clan?.members.find((entry) => entry.id === memberId);
    if (!member || !window.confirm(`Transfer ownership of [${clan?.tag}] to ${member.name}? You will become an officer.`)) return;
    await clanRequest('PUT', { action: 'transfer', memberId }, `Ownership transferred to ${member.name}`);
  };

  const removeClanMember = async (memberId: string) => {
    const member = clan?.members.find((entry) => entry.id === memberId);
    if (!member || !window.confirm(`Remove ${member.name} from the clan?`)) return;
    await clanRequest('DELETE', { action: 'remove', memberId }, `${member.name} removed from the clan`);
  };

  const leaveClan = async () => {
    if (!window.confirm('Leave this clan and lose access to its shared holdout?')) return;
    await clanRequest('DELETE', { action: 'leave' }, 'You left the clan');
  };

  const disbandClan = async () => {
    if (!clan || !window.confirm(`Permanently disband [${clan.tag}] ${clan.name}? The shared holdout will be deleted.`)) return;
    await clanRequest('DELETE', { action: 'disband' }, 'Clan disbanded');
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

  const durStrip = (s: { id: ItemId; qty: number; dur?: number } | null) => {
    if (!s) return null;
    const max = itemDef(s.id).durability;
    if (max === undefined) return null;
    const frac = (s.dur ?? max) / max;
    if (frac >= 0.999) return null;
    return <div className="dur-strip"><div style={{ width: `${frac * 100}%`, background: frac > 0.3 ? '#5fb96a' : '#c25047' }} /></div>;
  };

  const invSlot = (s: { id: ItemId; qty: number; dur?: number } | null, i: number) => (
    <Tip key={i} tip={s ? itemTip(s.id, s.qty, s.dur) : null}>
      <div
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
      >
        {i < 5 && <span className="keycap">{i + 1}</span>}
        {s && (<><ItemIcon id={s.id} />{s.qty > 1 && <span className="qty">{s.qty}</span>}{durStrip(s)}</>)}
      </div>
    </Tip>
  );

  const equipSlot = (zone: 'helmet' | 'vest' | 'mod', label: string) => {
    const id = inv?.equipment[zone] ?? null;
    const dur = zone === 'helmet' || zone === 'vest' ? inv?.armorDur?.[zone] : undefined;
    return (
      <Tip tip={id ? itemTip(id, 1, dur) : null}>
        <div
          className="equip-slot"
          onMouseDown={(e) => id && beginDrag(zone, 0, id, 1, e)}
          onMouseUp={() => dropOn(zone, 0)}
          onContextMenu={(e) => id && openCtx(zone, 0, id, 1, e)}
        >
          <span className="corner">{label}</span>
          {id && <ItemIcon id={id} size={32} />}
        </div>
      </Tip>
    );
  };

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="world" style={{ cursor: anyPanel ? 'default' : 'none' }} />
      {!connected && <div className="connect-overlay">CONNECTING TO THE ZONE…</div>}
      {hurtAt > 0 && <div className="hurt-flash" key={hurtAt} />}

      {connected && !showMap && (
        <div className="minimap-wrap">
          <canvas ref={minimapRef} width={MINIMAP_SIZE} height={MINIMAP_SIZE} />
          <span className="minimap-mode">LOCAL / {MINIMAP_VISIBLE_TILES} TILES</span>
        </div>
      )}

      {showMap && initRef.current && (
        <WorldMapOverlay
          canvasRef={worldMapRef}
          name={initRef.current.name}
          width={initRef.current.width}
          height={initRef.current.height}
          location={location}
          viewport={worldMapView}
          getPlayerPosition={getMapPlayerPosition}
          onViewportChange={updateWorldMapView}
          onClose={() => only(null)}
        />
      )}

      {location && <div className="location-banner" key={location}>{location.toUpperCase()}</div>}
      {inSafe && !inHideout && <div className="safe-chip">SAFE ZONE — extract to get home</div>}
      {inHideout && <div className="safe-chip">{
        initRef.current?.kind === 'clan_hideout'
          ? `CLAN HOLDOUT — B build · R rotate${canDemolishHideout ? ' · X demolish' : ''} · E at the mat to return`
          : ownHideout
            ? 'HOME BASE — B build · R rotate · X demolish · E at the mat to deploy'
            : 'ALLY CAMP — E at the mat to leave'
      }</div>}
      {heldKit && !anyPanel && (
        <div className="build-bar">
          <span>HOLDING <b>{itemDef(heldKit.item).name}</b>{heldKit.qty > 1 ? ` ×${heldKit.qty}` : ''}</span>
          <span className="build-hint">
            R rotate ({buildRotation * 90}°) · click the ground to place{inHideout ? '' : ' — wears out & is destructible in the world'} · scroll to swap hands
          </span>
          <button onClick={rotateBuild}>ROTATE 90°</button>
          <button onClick={() => emit(EV.invEquip, { slot: heldKit.slot })}>PUT AWAY</button>
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
            <div className="fill" style={{ width: `${Math.min(100, (weight / cap.maxKg) * 100)}%`, background: weight > cap.maxKg ? 'var(--red)' : 'var(--blue)' }} />
            <div className="label">
              {weight > cap.maxKg ? '⚠ OVERWEIGHT' : `${weight.toFixed(1)} / ${cap.maxKg} KG`}
            </div> 
            {/* <div className="label">{weight.toFixed(1)} / {cap.maxKg} KG{weight > cap.maxKg ? ' — ⚠ OVERWEIGHT' : ''}</div> */}
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
          <div className={`bar mini stamina${inv.staminaExhausted ? ' exhausted' : ''}`} title="Exhaustion prevents attacks and slows movement until 25 stamina recovers">
            <div className="fill" style={{ width: `${inv.stamina}%`, background: inv.staminaExhausted ? '#c85a4a' : inv.stamina > 25 ? '#5fd0a0' : 'var(--gold)' }} />
            <div className="label">{inv.staminaExhausted ? `EXHAUSTED ${inv.stamina}` : `STAM ${inv.stamina} · SHIFT run`}</div>
          </div>
          <div className="weapon-line">
            {equippedItem
              ? eqWeapon
                ? inv.reloading
                  ? `${itemDef(equippedItem.id).name} · RELOADING…`
                  : `${itemDef(equippedItem.id).name} · ${inv.mag}/${eqWeapon.magSize} · ${ammoReserve} reserve ${inv.mag === 0 ? '· R to reload' : ''}`
                : itemDef(equippedItem.id).kind === 'consumable'
                  ? `${itemDef(equippedItem.id).name} · ${(useVerb(itemDef(equippedItem.id)) ?? 'USE')} — left-click`
                  : itemDef(equippedItem.id).place
                    ? `${itemDef(equippedItem.id).name} · click the ground to place`
                    : itemDef(equippedItem.id).name
              : 'FISTS — punch trees & rocks, craft a spear (C)'}
          </div>
        </div>
      )}

      {/* hotbar */}
      {inv && (
        <div className="hotbar">
          {inv.inv.slots.slice(0, 5).map((s, i) => (
            <Tip key={i} tip={s ? itemTip(s.id, s.qty, s.dur) : null}>
              <div className={`slot${inv.equipped === i ? ' equipped' : ''}`} onClick={() => useSlot(i)}>
                <span className="keycap">{i + 1}</span>
                {s && (<><ItemIcon id={s.id} />{s.qty > 1 && <span className="qty">{s.qty}</span>}</>)}
              </div>
            </Tip>
          ))}
        </div>
      )}

      {/* contextual interaction hints (fish / drink / cook) */}
      {inv && !panelsOpenRef.current && !heldKit && (() => {
        const hasRod = equippedItem?.id === 'fishing_rod';
        const rawHeld = inv.inv.slots.filter((s) => s && itemDef(s.id).raw) as { id: ItemId; qty: number }[];
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
        {isGuest && <div className="kd-chip guest-self-chip">GUEST · TEMPORARY RAID</div>}
        {isAdmin && <div className="kd-chip admin-self-chip">ADMIN · F10</div>}
        <div className="online-chip">● {online} IN ZONE</div>
        {clock && <div className="kd-chip dim">{clock}</div>}
        {inv && <div className="kd-chip gold">{inv.money} cr</div>}
        {inv && <div className="kd-chip">☠ {inv.kills} · {inv.deaths}</div>}
        <div className="kd-chip dim">{muted ? 'SOUND OFF' : 'SOUND ON'}</div>
        <div className="killfeed">
          {feed.map((k) => (
            <div key={k.id}><b>{k.killer}</b> ☠ {k.victim}{k.weapon ? ` (${itemDef(k.weapon).name})` : ''}</div>
          ))}
        </div>
      </div>

      <div className="hotkey-bar">
        {([
          ['🎒', 'TAB', 'Gear & inventory', () => only(menuRef.current.gear ? null : 'gear')],
          ['⚒', 'C', 'Crafting', () => only(menuRef.current.craft ? null : 'craft')],
          ['📈', 'K', 'Skills', () => only(menuRef.current.skills ? null : 'skills')],
          ['👥', 'P', 'Community', () => { only(menuRef.current.social ? null : 'social'); refreshCommunity(); }],
          // building controls only show at home — out in the zone the hotbar stays lean
          ...(ownHideout
            ? ([
                ['🔨', 'B', 'Hold a build kit', () => {
                  const s = inv?.inv.slots.findIndex((x) => x && itemDef(x.id).place) ?? -1;
                  if (inv && s >= 0) holdKit(s);
                  else pushToast('Craft a build kit first (C → BUILD)');
                }],
                ...(canDemolishHideout ? [['⛏', 'X', 'Demolish structures', toggleDemolish] as [string, string, string, () => void]] : []),
              ] as [string, string, string, () => void][])
            : []),
          ['💬', '⏎', 'Chat', () => setChatOpen(true)],
        ] as [string, string, string, () => void][]).filter(([, key]) => !isGuest || (key !== 'P' && key !== '⏎')).map(([icon, key, label, fn]) => (
          <button key={key} className="hk" onClick={fn}>
            <span className="hk-icon">{icon}</span>
            <span className="hk-tip">{label} <b>{key}</b></span>
          </button>
        ))}
        <button className={`hk${showMap ? ' active' : ''}`} disabled={!connected} onClick={() => only(showMap ? null : 'map')} aria-label="Open world map">
          <span className="hk-icon"><WorldMapIcon /></span>
          <span className="hk-tip">World map <b>M</b></span>
        </button>
        <button className="hk" onClick={() => setMuted(toggleMute())} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
          <span className="hk-icon">{muted ? '🔇' : '🔊'}</span>
          <span className="hk-tip">Sound {muted ? 'off' : 'on'}</span>
        </button>
        {isAdmin && (
          <button className={`hk admin-self-chip${showAdmin ? ' active' : ''}`} onClick={() => only(showAdmin ? null : 'admin')} aria-label="Open administrator world control">
            <span className="hk-icon">A</span>
            <span className="hk-tip">World control <b>F10</b></span>
          </button>
        )}
      </div>

      <div className="toasts">{toasts.map((t) => <div key={t.id}>{t.msg}</div>)}</div>

      {/* chat log + input */}
      <div className="chat-log">
        {chatLog.filter((m) => Date.now() - m.at < 12000).map((m, i) => (
          <div key={i} className={m.channel === 'clan' ? 'clan-chat' : ''}>{m.admin && <span className="admin-chat-tag">ADMIN</span>}<b>{m.name}:</b> {m.text}</div>
        ))}
      </div>
      {!isGuest && chatOpen && (
        <div className="chat-bar">
          <input
            ref={chatInputRef}
            value={chatText}
            maxLength={120}
            placeholder="say in this area…  /c message for clan radio"
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
                  <span className="equip-name">{itemDef(equippedItem.id).name}{eqWeapon ? ` · ${inv.mag}/${eqWeapon.magSize}` : ''}</span>
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
              <h3>{container.storage ? 'STASH' : container.id.startsWith('b') ? 'LOOT BAG' : 'STORAGE'}</h3>
              <div className="slot-grid">
                {container.slots.map((s, i) => {
                  const looting = !!action && action.kind === 'loot' && action.container === container.id && action.slot === i;
                  const queuePos = !looting && lootContRef.current === container.id ? lootQueue.indexOf(i) : -1;
                  return (
                    <Tip key={i} tip={s ? itemTip(s.id, s.qty) : null}>
                    <div
                      className={`slot${drag?.zone === 'cont' && drag.index === i ? ' dragging' : ''}${looting ? ' looting' : ''}${queuePos >= 0 ? ' queued' : ''}`}
                      onMouseDown={(e) => s && beginDrag('cont', i, s.id, s.qty, e)}
                      onMouseUp={() => dropOn('cont', i)}
                      onClick={() => { if (justDragged.current) { justDragged.current = false; return; } if (s) enqueueLoot(i); }}
                      onContextMenu={(e) => s && openCtx('cont', i, s.id, s.qty, e)}
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
                    </Tip>
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
          <div className="ctx-title">{itemDef(ctxMenu.item).name}</div>
          {ctxMenu.zone === 'inv' && (() => {
            const def = itemDef(ctxMenu.item);
            const verb = useVerb(def);
            const rep = def.durability !== undefined && inv
              ? (def.kind === 'weapon' ? inv.nearAnvil : inv.nearWorkbench)
              : false;
            const worn = (() => { const s = inv?.inv.slots[ctxMenu.index]; return s && def.durability !== undefined && (s.dur ?? def.durability) < def.durability; })();
            return (
              <>
                {verb && <button onClick={() => ctxAction(def.place ? 'place' : 'use')}>{verb}</button>}
                {rep && worn && <button onClick={() => ctxAction('repair')}>REPAIR</button>}
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

      {showCraft && inv && (
        <CraftingPanel
          inventory={inv}
          action={action}
          tab={craftTab}
          selectedRecipeId={craftSel}
          queue={craftQueue}
          countItem={countOf}
          onSelectTab={setCraftTab}
          onSelectRecipe={setCraftSel}
          onEnqueue={(id, count = 1) =>
            setCraftQueue((queued) => [...queued, ...new Array<string>(count).fill(id)])
          }
          onClearQueue={() => setCraftQueue([])}
          station={station}
          onAddFuel={(quantity) => station?.index !== undefined && emit(EV.stationFuel, { index: station.index, qty: quantity })}
        />
      )}

      {station?.type === 'firepit' && inv && (
        <CookingPanel
          inventory={inv}
          action={action}
          queue={cookQueue}
          station={station}
          onQueueSlot={(slot) => setCookQueue((queued) => [...queued, slot])}
          onQueueAll={(slots) =>
            setCookQueue((queued) => {
              const next = [...queued];
              for (const { slot, quantity } of slots) {
                const alreadyQueued = next.filter((queuedSlot) => queuedSlot === slot).length;
                const currentlyCooking = action?.kind === 'cook' && action.slot === slot ? 1 : 0;
                for (let count = alreadyQueued + currentlyCooking; count < quantity; count++) next.push(slot);
              }
              return next;
            })
          }
          onAddFuel={(quantity) => station.index !== undefined && emit(EV.stationFuel, { index: station.index, qty: quantity })}
          onClose={() => {
            setCookQueue([]);
            setStation(null);
          }}
        />
      )}

      {/* starter objectives checklist */}
      {connected && !isGuest && !dead && !objectives.celebrated && !panelsOpenRef.current && (
        <div className="objectives">
          <div className="obj-title">OBJECTIVES</div>
          {OBJECTIVES.map((o) => (
            <div key={o.id} className={`obj-row${objectives[o.id] ? ' done' : ''}`}>
              {objectives[o.id] ? '☑' : '☐'} {o.label}
            </div>
          ))}
        </div>
      )}
      {connected && !dead && trackedJobs.length > 0 && !panelsOpenRef.current && (
        <div className="quest-tracker">
          <div className="quest-track-title">ACTIVE JOBS <span>claim at trader</span></div>
          {trackedJobs.map((job) => (
            <div key={job.def.id} className={`quest-track-row${job.done ? ' done' : ''}`}>
              <span className="quest-track-tier">T{job.def.tier}</span>
              <span className="quest-track-name">{job.def.name}</span>
              <b>{job.done ? 'RETURN' : `${job.progress}/${job.def.count}`}</b>
            </div>
          ))}
        </div>
      )}
      {showSkills && inv && <SkillsPanel inventory={inv} />}

      {trade && inv && (
        <TradePanel
          trade={trade}
          inventory={inv}
          tab={tradeTab}
          selectedBuyId={buySel}
          selectedSellSlot={sellSel}
          onSelectTab={setTradeTab}
          onSelectBuy={setBuySel}
          onSelectSell={setSellSel}
          onBuy={(id, quantity) => emit(EV.tradeBuy, { id, qty: quantity })}
          onSell={(slot, quantity) => emit(EV.tradeSell, { slot, qty: quantity })}
          onClaimQuest={(id) => emit(EV.questClaim, { id })}
          onClose={() => setTrade(null)}
        />
      )}

      {!isGuest && showSocial && (
        <SocialPanel
          friends={friends}
          username={friendUsername}
          message={friendMsg}
          canVisitCamps={(ownHideout && initRef.current?.kind === 'hideout') || (inSafe && !inHideout)}
          clan={clan}
          clanInvitations={clanInvitations}
          clanName={clanName}
          clanTag={clanTag}
          clanUsername={clanUsername}
          clanMessage={clanMsg}
          canEnterClanHoldout={Boolean(clan) && (inSafe || (inHideout && initRef.current?.kind === 'hideout')) && initRef.current?.kind !== 'clan_hideout'}
          onUsernameChange={setFriendUsername}
          onAddFriend={addFriend}
          onAcceptFriend={acceptFriend}
          onRemoveFriend={removeFriend}
          onVisitCamp={(owner) => {
            only(null);
            emit(EV.hideoutEnter, { owner });
          }}
          onClanNameChange={setClanName}
          onClanTagChange={setClanTag}
          onClanUsernameChange={setClanUsername}
          onCreateClan={() => void createClan()}
          onInviteClanMember={() => void inviteClanMember()}
          onAcceptClanInvite={(clanId) => void clanRequest('POST', { action: 'accept', clanId }, 'Joined clan — shared holdout access granted')}
          onDeclineClanInvite={(clanId) => void clanRequest('DELETE', { action: 'decline', clanId }, 'Clan invitation declined')}
          onSetClanRank={(memberId, rank) => void clanRequest('PUT', { action: 'rank', memberId, rank }, `Member rank changed to ${rank}`)}
          onTransferClan={(memberId) => void transferClan(memberId)}
          onRemoveClanMember={(memberId) => void removeClanMember(memberId)}
          onCancelClanInvite={(memberId) => void clanRequest('DELETE', { action: 'cancel_invite', memberId }, 'Invitation cancelled')}
          onLeaveClan={() => void leaveClan()}
          onDisbandClan={() => void disbandClan()}
          onEnterClanHoldout={() => {
            only(null);
            emit(EV.clanHideoutEnter);
          }}
          onClanTreasuryTransfer={(amount) => emit(EV.clanTreasury, { amount })}
        />
      )}

      {showAdmin && isAdmin && (
        <AdminPanel
          state={adminPanel}
          selfId={youRef.current}
          items={runtimeItems()}
          onAction={adminAction}
          onRefresh={() => emit(EV.adminRequest)}
          onClose={() => only(null)}
        />
      )}

      {escMenu && !dead && (
        <PauseOverlay
          guest={isGuest}
          inHideout={inHideout}
          inSafeZone={inSafe}
          muted={muted}
          onResume={() => setEscMenu(false)}
          onToggleSound={() => setMuted(toggleMute())}
          onReturnToMenu={returnToMenu}
          onLogOut={leave}
        />
      )}

      {dead && (
        <DeathOverlay
          guest={isGuest}
          killer={dead}
          inventory={inv}
          onRespawn={() => emit(EV.respawn)}
          onLogOut={leave}
        />
      )}
    </div>
  );
}
