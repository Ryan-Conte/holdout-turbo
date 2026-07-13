'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthoredMap, MapObject, Tile, TILE, type BlockDocument, type EngineBlockDefinition, type ResourceNodeDef, type SpriteDocument, type TerrainDocument } from '@holdout/shared';
import { CHAR_ROWS, ITEM_INDEX, loadSheets, type Sheets } from '@/game/sprites';
import {
  MAP_HISTORY_LIMIT as HISTORY_LIMIT,
  MAP_OBJECT_PALETTE as OBJECTS,
  MAX_MAP_SIZE as MAX_SIZE,
  MAX_MAP_ZOOM as MAX_ZOOM,
  MIN_MAP_SIZE as MIN_SIZE,
  MIN_MAP_ZOOM as MIN_ZOOM,
  TERRAIN_ID_BY_TILE,
  TERRAIN_PALETTE as TERRAIN,
  TILE_COLORS,
  cloneAuthoredMap as cloneMap,
  clampNumber as clamp,
  coordinateNoise as hash,
  mapObjectLabel as objectLabel,
  terrainTileLabel as tileLabel,
  type LootSummary as LootRecord,
  type MapCamera as Camera,
  type MapEditorTool as EditorTool,
  type MobSummary as MobRecord,
  type ViewportSize as Size,
} from './map-studio-model';

export function MapStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapBaseRef = useRef<HTMLCanvasElement | null>(null);
  const pixelFramesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const mapRef = useRef<AuthoredMap | null>(null);
  const cameraRef = useRef<Camera>({ x: 1600, y: 1600, zoom: 0.5 });
  const spaceHeldRef = useRef(false);
  const interactionRef = useRef<
    | { kind: 'pan'; pointerId: number; x: number; y: number }
    | { kind: 'paint'; pointerId: number; tileX: number; tileY: number; erase: boolean }
    | null
  >(null);
  const historyRef = useRef<{ past: AuthoredMap[]; future: AuthoredMap[] }>({ past: [], future: [] });
  const fittedRef = useRef(false);
  const inspectorEditingRef = useRef(false);

  const [map, setMap] = useState<AuthoredMap | null>(null);
  const [name, setName] = useState('Custom Map');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [publishedId, setPublishedId] = useState<number | null>(null);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const [view, setView] = useState<Size>({ width: 900, height: 650 });
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [tool, setTool] = useState<EditorTool>({ mode: 'select' });
  const [palette, setPalette] = useState<'terrain' | 'resources' | 'blocks' | 'objects' | 'elevation'>('terrain');
  const [brush, setBrush] = useState(1);
  const [selectedObject, setSelectedObject] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [mobs, setMobs] = useState<Record<string, MobRecord>>({});
  const [loot, setLoot] = useState<Record<string, LootRecord>>({});
  const [resources, setResources] = useState<Record<string, ResourceNodeDef>>({});
  const [blocks, setBlocks] = useState<Record<string, EngineBlockDefinition>>({});
  const [terrainDefs, setTerrainDefs] = useState<TerrainDocument>({});
  const [customMob, setCustomMob] = useState('zombie');
  const [customLoot, setCustomLoot] = useState('chest');
  const [pendingW, setPendingW] = useState(100);
  const [pendingH, setPendingH] = useState(100);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('Loading map and content...');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [minimapVersion, setMinimapVersion] = useState(0);

  mapRef.current = map;
  cameraRef.current = camera;

  const setCamera = useCallback((next: Camera | ((current: Camera) => Camera)) => {
    setCameraState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      cameraRef.current = resolved;
      return resolved;
    });
  }, []);

  const pushHistory = useCallback(() => {
    const current = mapRef.current;
    if (!current) return;
    const history = historyRef.current;
    history.past.push(cloneMap(current));
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    setHistoryVersion((version) => version + 1);
  }, []);

  const updateMap = useCallback((updater: (current: AuthoredMap) => AuthoredMap) => {
    setMap((current) => {
      if (!current) return current;
      const next = updater(current);
      mapRef.current = next;
      return next;
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const current = mapRef.current;
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!current || !previous) return;
    history.future.push(cloneMap(current));
    setMap(previous);
    mapRef.current = previous;
    setSelectedObject(null);
    setDirty(true);
    setHistoryVersion((version) => version + 1);
  }, []);

  const redo = useCallback(() => {
    const current = mapRef.current;
    const history = historyRef.current;
    const next = history.future.pop();
    if (!current || !next) return;
    history.past.push(cloneMap(current));
    setMap(next);
    mapRef.current = next;
    setSelectedObject(null);
    setDirty(true);
    setHistoryVersion((version) => version + 1);
  }, []);

  const fitMap = useCallback(() => {
    const current = mapRef.current;
    if (!current) return;
    const zoom = clamp(Math.min((view.width - 80) / (current.w * TILE), (view.height - 80) / (current.h * TILE)), MIN_ZOOM, 2);
    setCamera({ x: current.w * TILE / 2, y: current.h * TILE / 2, zoom });
  }, [setCamera, view.height, view.width]);

  const zoomAt = useCallback((screenX: number, screenY: number, nextZoom: number) => {
    const current = cameraRef.current;
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const worldX = current.x + (screenX - view.width / 2) / current.zoom;
    const worldY = current.y + (screenY - view.height / 2) / current.zoom;
    setCamera({
      x: worldX - (screenX - view.width / 2) / zoom,
      y: worldY - (screenY - view.height / 2) / zoom,
      zoom,
    });
  }, [setCamera, view.height, view.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      setView({ width: Math.max(320, entry.contentRect.width), height: Math.max(360, entry.contentRect.height) });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/api/admin/map', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/mobs', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/loot', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/resources', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/blocks', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/terrain', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/admin/content/sprites', { cache: 'no-store' }).then((response) => response.json()),
      loadSheets(),
    ]).then(([mapData, mobData, lootData, resourceData, blockData, terrainData, spriteData, loadedSheets]) => {
      if (cancelled) return;
      const loaded = mapData.map?.data as AuthoredMap | undefined;
      const next = loaded && loaded.tiles?.length === loaded.w * loaded.h
        ? cloneMap(loaded)
        : { w: 100, h: 100, tiles: new Array(10_000).fill(Tile.Grass), elevations: new Array(10_000).fill(0), terrain: Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [String(index), 'grass'])), objects: [] };
      next.terrain = Object.fromEntries(next.tiles.map((tile, index) => [String(index), next.terrain?.[String(index)] ?? TERRAIN_ID_BY_TILE[tile] ?? 'grass']));
      setMap(next);
      mapRef.current = next;
      setName(mapData.map?.name ?? 'Custom Map');
      setDraftId(mapData.map?.draft ? mapData.map.id : null);
      setPublishedId(mapData.published?.id ?? null);
      setPendingW(next.w);
      setPendingH(next.h);
      setMobs((mobData.published ?? mobData.draft ?? {}) as Record<string, MobRecord>);
      setLoot((lootData.published ?? lootData.draft ?? {}) as Record<string, LootRecord>);
      setResources((resourceData.published ?? resourceData.draft ?? {}) as Record<string, ResourceNodeDef>);
      const blockDocument = (blockData.published ?? blockData.draft ?? {}) as Partial<BlockDocument>;
      setBlocks(blockDocument.world ?? {});
      setTerrainDefs((terrainData.published ?? terrainData.draft ?? {}) as TerrainDocument);
      const spriteDocument = (spriteData.published ?? spriteData.draft ?? { assets: [] }) as SpriteDocument;
      pixelFramesRef.current = new Map(spriteDocument.assets.flatMap((asset) => {
        const pixels = asset.frames?.[0]?.length === asset.width * asset.height ? asset.frames[0] : asset.pixels;
        if (pixels.length !== asset.width * asset.height) return [];
        const canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height;
        const context = canvas.getContext('2d'); if (!context) return [];
        pixels.forEach((color, index) => { context.fillStyle = color; context.fillRect(index % asset.width, Math.floor(index / asset.width), 1, 1); });
        return [[asset.id, canvas] as [string, HTMLCanvasElement]];
      }));
      setSheets(loadedSheets);
      setStatus(mapData.map ? `Loaded ${mapData.map.draft ? 'draft' : 'published map'}` : 'New map ready');
      setDirty(false);
    }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!map || fittedRef.current || view.width <= 320) return;
    fittedRef.current = true;
    fitMap();
  }, [fitMap, map, view.width]);

  const drawTile = useCallback((ctx: CanvasRenderingContext2D, tile: number, tx: number, ty: number) => {
    const x = tx * TILE;
    const y = ty * TILE;
    if (!sheets) {
      ctx.fillStyle = TILE_COLORS[tile] ?? TILE_COLORS[Tile.Grass];
      ctx.fillRect(x, y, TILE, TILE);
      return;
    }
    const grassCol = hash(tx, ty) < 0.5 ? 0 : 1;
    const baseCol = tile === Tile.Water ? 2 : tile === Tile.Sand ? 3 : tile === Tile.Road ? 4
      : tile === Tile.Asphalt ? 5 : tile === Tile.Floor ? 6 : tile === Tile.Wall ? 7
        : tile === Tile.DoorMat ? 8 : tile === Tile.Bed ? 13 : tile === Tile.Cliff ? 28 : grassCol;
    ctx.drawImage(sheets.tiles, baseCol * 16, 0, 16, 16, x, y, TILE, TILE);
  }, [sheets]);

  const drawTerrainOverlay = useCallback((ctx: CanvasRenderingContext2D, tile: number, tx: number, ty: number) => {
    if (!sheets) return;
    const x = tx * TILE;
    const y = ty * TILE;
    const overlay = tile === Tile.Rock ? 12 : tile === Tile.CopperOre ? 25 : tile === Tile.IronOre ? 26 : -1;
    if (overlay >= 0) ctx.drawImage(sheets.tiles, overlay * 16, 0, 16, 16, x, y, TILE, TILE);
    if (tile === Tile.Tree) ctx.drawImage(sheets.tiles, 10 * 16, 0, 32, 32, x - TILE / 2, y - TILE, TILE * 2, TILE * 2);
  }, [sheets]);

  const drawCharacter = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, row: number, frame: number) => {
    if (!sheets) return;
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(sheets.chars, frame * 16, row * 16, 16, 16, x - 16, y - 18, 32, 32);
  }, [sheets]);

  const drawObject = useCallback((ctx: CanvasRenderingContext2D, object: MapObject, index: number, time: number) => {
    const x = object.x * TILE + TILE / 2;
    const y = object.y * TILE + TILE / 2;
    const pulse = 0.72 + Math.sin(time / 320 + index) * 0.18;
    const frame = Math.floor(time / 420 + index) % 2;

    if (object.type.startsWith('poi_') || object.type === 'trader') {
      if (showZones) {
        const radius = (object.r ?? (object.type === 'trader' ? 8 : 14)) * TILE;
        const safe = object.safe ?? (object.type === 'trader' || object.type === 'poi_outpost');
        const hot = object.hot ?? (object.type === 'poi_airport' || object.type === 'poi_hotzone');
        ctx.fillStyle = safe ? 'rgba(79,178,108,.08)' : hot ? 'rgba(226,89,48,.08)' : 'rgba(206,154,71,.06)';
        ctx.strokeStyle = safe ? 'rgba(102,221,133,.7)' : hot ? 'rgba(244,99,60,.72)' : 'rgba(216,162,74,.55)';
        ctx.lineWidth = 2 / cameraRef.current.zoom;
        ctx.setLineDash([10 / cameraRef.current.zoom, 7 / cameraRef.current.zoom]);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (object.type.startsWith('poi_')) {
        if (showLabels) {
          ctx.fillStyle = '#f0dfb5';
          ctx.font = 'bold 13px Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(object.name ?? objectLabel(object, mobs), x, y - 12);
        }
        return;
      }
    }

    if (object.type === 'chest' || object.type === 'chest_custom' || object.type === 'chest_military') {
      const military = object.type === 'chest_military';
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fillRect(x - 12, y + 7, 24, 5);
      ctx.fillStyle = military ? '#4e6340' : '#805429';
      ctx.fillRect(x - 12, y - 9, 24, 17);
      ctx.fillStyle = military ? '#6d8459' : '#ad7737';
      ctx.fillRect(x - 12, y - 9, 24, 5);
      ctx.strokeStyle = object.type === 'chest_custom' ? '#f0c458' : '#2b2114';
      ctx.lineWidth = object.type === 'chest_custom' ? 2 : 1;
      ctx.strokeRect(x - 12, y - 9, 24, 17);
      ctx.fillStyle = object.type === 'chest_custom' ? '#f0c458' : '#d8d2b8';
      ctx.fillRect(x - 2, y - 3, 4, 6);
    } else if (object.type === 'loot') {
      if (sheets) {
        const col = ITEM_INDEX.scrap ?? 11;
        ctx.drawImage(sheets.items, col * 16, 0, 16, 16, x - 11, y - 11, 22, 22);
      }
    } else if (object.type === 'spawn') {
      ctx.strokeStyle = `rgba(240,216,120,${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 10 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f0d878'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    } else if (object.type === 'extract') {
      ctx.strokeStyle = `rgba(92,235,141,${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 12 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#62e593'; ctx.fillRect(x - 3, y - 10, 6, 20); ctx.fillRect(x - 10, y - 3, 20, 6);
    } else if (object.type === 'trader' || object.type === 'trader_black') {
      drawCharacter(ctx, x, y, CHAR_ROWS.trader, frame);
    } else {
      const id = object.type === 'mob' ? object.contentId ?? 'military' : object.type;
      const row = id === 'zombie' ? CHAR_ROWS.zombie : id === 'military' ? CHAR_ROWS.military
        : id === 'deer' ? CHAR_ROWS.deer : id === 'rabbit' ? CHAR_ROWS.rabbit
          : id === 'boar' ? CHAR_ROWS.boar : id === 'wolf' ? CHAR_ROWS.wolf
            : mobs[id]?.spriteId?.startsWith('character:')
              ? ({ zombie: 8, military: 9, trader: 10, deer: 11, rabbit: 12, boar: 13, wolf: 14 } as Record<string, number>)[mobs[id].spriteId!.slice(10)] ?? CHAR_ROWS.military
              : CHAR_ROWS.military;
      drawCharacter(ctx, x, y, row, frame);
      if (mobs[id]?.boss) {
        ctx.fillStyle = '#f0b24c'; ctx.font = 'bold 10px Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText('BOSS', x, y - 25);
      }
    }

    if (showLabels && cameraRef.current.zoom >= 0.42 && !object.type.startsWith('poi_')) {
      ctx.font = '10px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 / cameraRef.current.zoom;
      ctx.strokeStyle = 'rgba(8,9,7,.85)';
      ctx.fillStyle = '#d9d8ca';
      const label = object.name ?? objectLabel(object, mobs);
      ctx.strokeText(label, x, y - 24);
      ctx.fillText(label, x, y - 24);
    }
  }, [drawCharacter, mobs, sheets, showLabels, showZones]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    let animation = 0;
    const render = (time: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(view.width * dpr);
      const pixelHeight = Math.round(view.height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#080a08';
      ctx.fillRect(0, 0, view.width, view.height);

      const currentCamera = cameraRef.current;
      const left = currentCamera.x - view.width / (2 * currentCamera.zoom);
      const top = currentCamera.y - view.height / (2 * currentCamera.zoom);
      const right = currentCamera.x + view.width / (2 * currentCamera.zoom);
      const bottom = currentCamera.y + view.height / (2 * currentCamera.zoom);
      const minX = clamp(Math.floor(left / TILE) - 2, 0, map.w - 1);
      const minY = clamp(Math.floor(top / TILE) - 2, 0, map.h - 1);
      const maxX = clamp(Math.ceil(right / TILE) + 2, 0, map.w - 1);
      const maxY = clamp(Math.ceil(bottom / TILE) + 2, 0, map.h - 1);

      ctx.save();
      ctx.translate(view.width / 2, view.height / 2);
      ctx.scale(currentCamera.zoom, currentCamera.zoom);
      ctx.translate(-currentCamera.x, -currentCamera.y);
      for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
        const terrain = terrainDefs[map.terrain?.[String(ty * map.w + tx)] ?? ''];
        ctx.fillStyle = terrain?.minimapColor ?? '#527741';
        ctx.globalAlpha = 1;
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        const frame = terrain ? pixelFramesRef.current.get(terrain.spriteId) : undefined;
        if (frame) ctx.drawImage(frame, tx * TILE, ty * TILE, TILE, TILE);
      }
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          const index = String(ty * map.w + tx);
          if (!map.resources?.[index]) drawTerrainOverlay(ctx, map.tiles[ty * map.w + tx], tx, ty);
        }
      }
      for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
        const index = String(ty * map.w + tx);
        const blockId = map.blocks?.[index];
        const contentId = blockId ?? map.resources?.[index];
        if (!contentId) continue;
        const definition = blockId ? blocks[blockId] : resources[contentId];
        const spriteId = blockId ? blocks[blockId]?.spriteId : resources[contentId]?.spriteId;
        const frame = spriteId ? pixelFramesRef.current.get(spriteId) : undefined;
        if (frame) {
          const scale = blockId ? blocks[blockId]?.scale ?? 1 : 1;
          const width = frame.width * 2 * scale; const height = frame.height * 2 * scale;
          if (blockId) {
            const quarterTurn = ((map.blockRotations?.[index] ?? 0) % 4 + 4) % 4;
            const renderedHeight = quarterTurn % 2 ? width : height;
            ctx.save();
            ctx.translate(tx * TILE + TILE / 2, ty * TILE + TILE - renderedHeight / 2 - (blocks[blockId]?.offsetY ?? 0));
            ctx.rotate(quarterTurn * Math.PI / 2);
            ctx.drawImage(frame, -width / 2, -height / 2, width, height);
            ctx.restore();
          } else ctx.drawImage(frame, tx * TILE + TILE / 2 - width / 2, ty * TILE + TILE - height, width, height);
        }
        ctx.save();
        ctx.strokeStyle = blockId ? '#69b7c9' : '#e0bb58'; ctx.lineWidth = 1.5 / currentCamera.zoom;
        ctx.strokeRect(tx * TILE + 3, ty * TILE + 3, TILE - 6, TILE - 6);
        if (currentCamera.zoom >= .45) {
          ctx.fillStyle = 'rgba(20,17,10,.82)'; ctx.fillRect(tx * TILE + 3, ty * TILE + TILE - 11, TILE - 6, 9);
          ctx.fillStyle = blockId ? '#9edbe8' : '#f0d77e'; ctx.font = `bold ${Math.min(12, 7 / currentCamera.zoom)}px monospace`; ctx.textAlign = 'center';
          ctx.fillText((definition?.name ?? contentId).slice(0, 7).toUpperCase(), tx * TILE + TILE / 2, ty * TILE + TILE - 4);
        }
        ctx.restore();
      }

      for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) {
        const level = map.elevations?.[ty * map.w + tx] ?? 0;
        if (!level) continue;
        const x = tx * TILE; const y = ty * TILE;
        ctx.fillStyle = `rgba(214,190,125,${0.035 * level})`;
        ctx.fillRect(x, y, TILE, TILE);
        const south = ty + 1 < map.h ? map.elevations?.[(ty + 1) * map.w + tx] ?? 0 : 0;
        const east = tx + 1 < map.w ? map.elevations?.[ty * map.w + tx + 1] ?? 0 : 0;
        if (level > south) { ctx.fillStyle = `rgba(38,31,25,${Math.min(.72, .2 + (level - south) * .18)})`; ctx.fillRect(x, y + TILE - Math.min(12, (level - south) * 4), TILE, Math.min(12, (level - south) * 4)); }
        if (level > east) { ctx.fillStyle = 'rgba(35,30,24,.3)'; ctx.fillRect(x + TILE - 3, y, 3, TILE); }
        ctx.fillStyle = 'rgba(239,221,166,.16)'; ctx.fillRect(x, y, TILE, 2);
      }

      if (showGrid && currentCamera.zoom >= 0.35) {
        ctx.strokeStyle = currentCamera.zoom >= 1 ? 'rgba(8,10,8,.22)' : 'rgba(8,10,8,.12)';
        ctx.lineWidth = 1 / currentCamera.zoom;
        ctx.beginPath();
        for (let tx = minX; tx <= maxX + 1; tx++) { ctx.moveTo(tx * TILE, minY * TILE); ctx.lineTo(tx * TILE, (maxY + 1) * TILE); }
        for (let ty = minY; ty <= maxY + 1; ty++) { ctx.moveTo(minX * TILE, ty * TILE); ctx.lineTo((maxX + 1) * TILE, ty * TILE); }
        ctx.stroke();
      }

      map.objects.forEach((object, index) => {
        const wx = object.x * TILE + TILE / 2;
        const wy = object.y * TILE + TILE / 2;
        const radius = (object.r ?? 0) * TILE;
        if (wx + radius < left || wx - radius > right || wy + radius < top || wy - radius > bottom) return;
        drawObject(ctx, object, index, time);
      });

      if (selectedObject !== null && map.objects[selectedObject]) {
        const selected = map.objects[selectedObject];
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 2 / currentCamera.zoom;
        ctx.setLineDash([5 / currentCamera.zoom, 4 / currentCamera.zoom]);
        ctx.strokeRect(selected.x * TILE + 2, selected.y * TILE + 2, TILE - 4, TILE - 4);
        ctx.setLineDash([]);
      }
      if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < map.w && hover.y < map.h) {
        const radius = tool.mode === 'terrainDef' || tool.mode === 'elevation' ? brush - 1 : 0;
        ctx.fillStyle = tool.mode === 'erase' ? 'rgba(220,80,62,.22)' : 'rgba(240,216,120,.16)';
        ctx.strokeStyle = tool.mode === 'erase' ? '#e36d58' : '#f0d878';
        ctx.lineWidth = 1.5 / currentCamera.zoom;
        ctx.fillRect((hover.x - radius) * TILE, (hover.y - radius) * TILE, (radius * 2 + 1) * TILE, (radius * 2 + 1) * TILE);
        ctx.strokeRect((hover.x - radius) * TILE, (hover.y - radius) * TILE, (radius * 2 + 1) * TILE, (radius * 2 + 1) * TILE);
      }
      ctx.strokeStyle = '#c9a24e';
      ctx.lineWidth = 2 / currentCamera.zoom;
      ctx.strokeRect(0, 0, map.w * TILE, map.h * TILE);
      ctx.restore();

      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [blocks, brush, drawObject, drawTerrainOverlay, hover, map, resources, selectedObject, showGrid, terrainDefs, tool.mode, view.height, view.width]);

  useEffect(() => {
    if (!map) return;
    const timer = window.setTimeout(() => {
    const width = 210;
    const height = 150;
    const base = document.createElement('canvas');
    base.width = width;
    base.height = height;
    const ctx = base.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a0b09'; ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / map.w, height / map.h);
    const ox = (width - map.w * scale) / 2;
    const oy = (height - map.h * scale) / 2;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        ctx.fillStyle = TILE_COLORS[map.tiles[y * map.w + x]] ?? TILE_COLORS[Tile.Grass];
        const authoredTerrain = terrainDefs[map.terrain?.[String(y * map.w + x)] ?? ''];
        if (authoredTerrain) ctx.fillStyle = authoredTerrain.minimapColor;
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(1, scale), Math.max(1, scale));
        const level = map.elevations?.[y * map.w + x] ?? 0;
        if (level) { ctx.fillStyle = `rgba(247,222,162,${level * .13})`; ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(1, scale), Math.max(1, scale)); }
      }
    }
    for (const object of map.objects) {
      ctx.fillStyle = object.type === 'spawn' ? '#ffe27a' : object.type === 'extract' ? '#62e593'
        : object.type.startsWith('poi_') ? '#e26c4d' : '#e9dfc3';
      ctx.fillRect(ox + object.x * scale - 1, oy + object.y * scale - 1, 3, 3);
    }
    minimapBaseRef.current = base;
    setMinimapVersion((version) => version + 1);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [map, terrainDefs]);

  useEffect(() => {
    const canvas = minimapRef.current;
    const base = minimapBaseRef.current;
    if (!canvas || !base || !map) return;
    const width = 210;
    const height = 150;
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.drawImage(base, 0, 0);
    const scale = Math.min(width / map.w, height / map.h);
    const ox = (width - map.w * scale) / 2;
    const oy = (height - map.h * scale) / 2;
    const current = cameraRef.current;
    const worldLeft = current.x - view.width / (2 * current.zoom);
    const worldTop = current.y - view.height / (2 * current.zoom);
    const worldWidth = view.width / current.zoom;
    const worldHeight = view.height / current.zoom;
    ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + worldLeft / TILE * scale, oy + worldTop / TILE * scale, worldWidth / TILE * scale, worldHeight / TILE * scale);
  }, [camera, map, minimapVersion, view.height, view.width]);

  const screenPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { screenX: 0, screenY: 0 };
    const rect = canvas.getBoundingClientRect();
    // The backing canvas uses logical viewport pixels and can be CSS-scaled by
    // the minimum editor height. Normalize input into that same coordinate space.
    const screenX = (clientX - rect.left) * view.width / Math.max(1, rect.width);
    const screenY = (clientY - rect.top) * view.height / Math.max(1, rect.height);
    return { screenX, screenY };
  };

  const screenToTile = (clientX: number, clientY: number) => {
    const { screenX, screenY } = screenPoint(clientX, clientY);
    const current = cameraRef.current;
    const worldX = current.x + (screenX - view.width / 2) / current.zoom;
    const worldY = current.y + (screenY - view.height / 2) / current.zoom;
    return { x: Math.floor(worldX / TILE), y: Math.floor(worldY / TILE), screenX, screenY };
  };

  const paintLine = (fromX: number, fromY: number, toX: number, toY: number, erase: boolean) => {
    const current = mapRef.current;
    if (!current) return;
    const points: { x: number; y: number }[] = [];
    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), 1);
    for (let step = 0; step <= steps; step++) {
      points.push({ x: Math.round(fromX + (toX - fromX) * step / steps), y: Math.round(fromY + (toY - fromY) * step / steps) });
    }
    updateMap((source) => {
      const tiles = source.tiles.slice();
      const elevations = source.elevations?.slice() ?? new Array(source.w * source.h).fill(0);
      const terrainKinds = { ...(source.terrain ?? {}) };
      const resourceKinds = { ...(source.resources ?? {}) };
      const blockKinds = { ...(source.blocks ?? {}) };
      const blockRotations = { ...(source.blockRotations ?? {}) };
      let objects = source.objects;
      for (const point of points) {
        if (point.x < 0 || point.y < 0 || point.x >= source.w || point.y >= source.h) continue;
        if (erase) {
          const nextObjects = objects.filter((object) => Math.hypot(object.x - point.x, object.y - point.y) > 0.7);
          if (nextObjects.length !== objects.length) objects = nextObjects;
          else {
            const index = point.y * source.w + point.x;
            if (blockKinds[String(index)]) { delete blockKinds[String(index)]; delete blockRotations[String(index)]; }
            else {
              terrainKinds[String(index)] = 'grass';
              tiles[index] = terrainDefs.grass?.simulationTile ?? Tile.Grass;
              delete resourceKinds[String(index)];
            }
          }
        } else if (tool.mode === 'terrainDef') {
          const radius = brush - 1;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const x = point.x + dx; const y = point.y + dy;
            if (x >= 0 && y >= 0 && x < source.w && y < source.h) {
              const index = y * source.w + x;
              terrainKinds[String(index)] = tool.id;
              tiles[index] = terrainDefs[tool.id]?.simulationTile ?? Tile.Grass;
              delete resourceKinds[String(index)];
            }
          }
        } else if (tool.mode === 'resource') {
          const radius = brush - 1;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const x = point.x + dx; const y = point.y + dy;
            if (x >= 0 && y >= 0 && x < source.w && y < source.h) {
              const index = y * source.w + x;
              tiles[index] = tool.tile;
              resourceKinds[String(index)] = tool.id;
              delete blockKinds[String(index)];
              delete blockRotations[String(index)];
            }
          }
        } else if (tool.mode === 'block') {
          const radius = brush - 1;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const x = point.x + dx; const y = point.y + dy;
            if (x >= 0 && y >= 0 && x < source.w && y < source.h) {
              const index = y * source.w + x;
              blockKinds[String(index)] = tool.id;
              if (tool.rotation) blockRotations[String(index)] = tool.rotation;
              else delete blockRotations[String(index)];
              delete resourceKinds[String(index)];
            }
          }
        } else if (tool.mode === 'elevation') {
          const radius = brush - 1;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            const x = point.x + dx; const y = point.y + dy;
            if (x >= 0 && y >= 0 && x < source.w && y < source.h) elevations[y * source.w + x] = tool.level;
          }
        }
      }
      return { ...source, tiles, elevations, terrain: terrainKinds, resources: resourceKinds, blocks: blockKinds, blockRotations, objects };
    });
  };

  const selectAt = (x: number, y: number) => {
    const current = mapRef.current;
    if (!current) return;
    let closest: number | null = null;
    let distance = 1.2;
    current.objects.forEach((object, index) => {
      const nextDistance = Math.hypot(object.x - x, object.y - y);
      if (nextDistance < distance) { distance = nextDistance; closest = index; }
    });
    setSelectedObject(closest);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = screenToTile(event.clientX, event.clientY);
    const pan = event.button === 1 || (event.button === 0 && (spaceHeldRef.current || tool.mode === 'pan'));
    if (pan) {
      interactionRef.current = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 2 || tool.mode === 'erase') {
      pushHistory();
      paintLine(point.x, point.y, point.x, point.y, true);
      interactionRef.current = { kind: 'paint', pointerId: event.pointerId, tileX: point.x, tileY: point.y, erase: true };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (tool.mode === 'select') {
      selectAt(point.x, point.y);
      return;
    }
    if (tool.mode === 'terrainDef' || tool.mode === 'resource' || tool.mode === 'block' || tool.mode === 'elevation') {
      pushHistory();
      paintLine(point.x, point.y, point.x, point.y, false);
      interactionRef.current = { kind: 'paint', pointerId: event.pointerId, tileX: point.x, tileY: point.y, erase: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool.mode === 'object' && mapRef.current && point.x >= 0 && point.y >= 0 && point.x < mapRef.current.w && point.y < mapRef.current.h) {
      pushHistory();
      const object: MapObject = { ...tool.template, x: point.x, y: point.y };
      const nextIndex = mapRef.current.objects.length;
      updateMap((current) => ({ ...current, objects: [...current.objects, object] }));
      setSelectedObject(nextIndex);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = screenToTile(event.clientX, event.clientY);
    setHover({ x: point.x, y: point.y });
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (interaction.kind === 'pan') {
      const dx = event.clientX - interaction.x;
      const dy = event.clientY - interaction.y;
      interaction.x = event.clientX;
      interaction.y = event.clientY;
      setCamera((current) => ({ ...current, x: current.x - dx / current.zoom, y: current.y - dy / current.zoom }));
    } else if (point.x !== interaction.tileX || point.y !== interaction.tileY) {
      paintLine(interaction.tileX, interaction.tileY, point.x, point.y, interaction.erase);
      interaction.tileX = point.x;
      interaction.tileY = point.y;
    }
  };

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.code === 'Space') { event.preventDefault(); spaceHeldRef.current = true; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key.toLowerCase() === 'v') setTool({ mode: 'select' });
      else if (event.key.toLowerCase() === 'h') setTool({ mode: 'pan' });
      else if (event.key.toLowerCase() === 'e') setTool({ mode: 'erase' });
      else if (event.key.toLowerCase() === 'f') fitMap();
      else if (event.key.toLowerCase() === 'r') setTool((current) => current.mode === 'block' ? { ...current, rotation: (current.rotation + 1) % 4 } : current);
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObject !== null) {
        pushHistory();
        updateMap((current) => ({ ...current, objects: current.objects.filter((_, index) => index !== selectedObject) }));
        setSelectedObject(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spaceHeldRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [fitMap, pushHistory, redo, selectedObject, undo, updateMap]);

  const saveDraft = async (): Promise<number | null> => {
    const current = mapRef.current;
    if (!current) return null;
    setStatus('Saving private draft...');
    const response = await fetch('/api/admin/map', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draftId, name, data: current }),
    });
    const data = await response.json();
    if (!response.ok) { setStatus(`Save failed: ${data.error}`); return null; }
    setDraftId(data.id);
    setDirty(false);
    setStatus(`Draft #${data.id} saved at ${new Date(data.updatedAt).toLocaleTimeString()}`);
    return data.id;
  };

  const validationErrors = map ? [
    ...map.objects.filter((object) => object.type === 'mob' && !mobs[object.contentId ?? '']).map((object) => `Unknown mob: ${object.contentId}`),
    ...map.objects.filter((object) => object.type === 'chest_custom' && !loot[object.lootTable ?? '']).map((object) => `Unknown loot table: ${object.lootTable}`),
    ...Object.values(map.resources ?? {}).filter((id) => !resources[id]).map((id) => `Unknown resource: ${id}`),
    ...Object.values(map.terrain ?? {}).filter((id) => !terrainDefs[id]).map((id) => `Unknown terrain: ${id}`),
    ...Object.values(map.blocks ?? {}).filter((id) => !blocks[id]).map((id) => `Unknown block: ${id}`),
  ] : [];

  const publish = async () => {
    if (validationErrors.length) { setStatus(`Publish blocked: ${validationErrors[0]}`); return; }
    const id = await saveDraft();
    if (!id) return;
    setStatus('Publishing live revision...');
    const response = await fetch('/api/admin/map', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    const data = await response.json();
    if (!response.ok) { setStatus(`Publish failed: ${data.error}`); return; }
    setPublishedId(data.id);
    setStatus(`Published map #${data.id}. Servers adopt it when the world is empty.`);
  };

  const applySize = () => {
    const current = mapRef.current;
    if (!current) return;
    const width = clamp(Math.round(pendingW), MIN_SIZE, MAX_SIZE);
    const height = clamp(Math.round(pendingH), MIN_SIZE, MAX_SIZE);
    if (width === current.w && height === current.h) return;
    pushHistory();
    updateMap((source) => {
      const tiles = new Array(width * height).fill(Tile.Grass);
      const elevations = new Array(width * height).fill(0);
      const terrainKinds: Record<string, string> = Object.fromEntries(Array.from({ length: width * height }, (_, index) => [String(index), 'grass']));
      const resourceKinds: Record<string, string> = {};
      const blockKinds: Record<string, string> = {};
      const blockRotations: Record<string, number> = {};
      for (let y = 0; y < Math.min(height, source.h); y++) for (let x = 0; x < Math.min(width, source.w); x++) { tiles[y * width + x] = source.tiles[y * source.w + x]; elevations[y * width + x] = source.elevations?.[y * source.w + x] ?? 0; }
      for (const [rawIndex, resourceId] of Object.entries(source.resources ?? {})) {
        const oldIndex = Number(rawIndex); const x = oldIndex % source.w; const y = Math.floor(oldIndex / source.w);
        if (x < width && y < height) resourceKinds[String(y * width + x)] = resourceId;
      }
      for (const [rawIndex, terrainId] of Object.entries(source.terrain ?? {})) {
        const oldIndex = Number(rawIndex); const x = oldIndex % source.w; const y = Math.floor(oldIndex / source.w);
        if (x < width && y < height) terrainKinds[String(y * width + x)] = terrainId;
      }
      for (const [rawIndex, blockId] of Object.entries(source.blocks ?? {})) {
        const oldIndex = Number(rawIndex); const x = oldIndex % source.w; const y = Math.floor(oldIndex / source.w);
        if (x < width && y < height) {
          const index = String(y * width + x); blockKinds[index] = blockId;
          const rotation = source.blockRotations?.[rawIndex] ?? 0; if (rotation) blockRotations[index] = rotation;
        }
      }
      return { w: width, h: height, tiles, elevations, terrain: terrainKinds, resources: resourceKinds, blocks: blockKinds, blockRotations, objects: source.objects.filter((object) => object.x < width && object.y < height) };
    });
    setPendingW(width); setPendingH(height); setSelectedObject(null);
    const zoom = clamp(Math.min((view.width - 80) / (width * TILE), (view.height - 80) / (height * TILE)), MIN_ZOOM, 2);
    setCamera({ x: width * TILE / 2, y: height * TILE / 2, zoom });
  };

  const updateSelected = (patch: Partial<MapObject>) => {
    if (selectedObject === null) return;
    updateMap((current) => ({ ...current, objects: current.objects.map((object, index) => index === selectedObject ? { ...object, ...patch } : object) }));
  };

  const beginInspectorEdit = () => {
    if (inspectorEditingRef.current) return;
    inspectorEditingRef.current = true;
    pushHistory();
  };

  const endInspectorEdit = () => { inspectorEditingRef.current = false; };

  const deleteSelected = () => {
    if (selectedObject === null) return;
    pushHistory();
    updateMap((current) => ({ ...current, objects: current.objects.filter((_, index) => index !== selectedObject) }));
    setSelectedObject(null);
  };

  const customMobTool = (): EditorTool => ({
    mode: 'object', id: `mob:${customMob}`,
    template: { type: 'mob', contentId: customMob, respawnMs: mobs[customMob]?.respawnMs ?? 90_000 },
  });
  const customLootTool = (): EditorTool => ({
    mode: 'object', id: `loot:${customLoot}`, template: { type: 'chest_custom', lootTable: customLoot },
  });
  const selected = selectedObject !== null && map ? map.objects[selectedObject] : null;
  const objectGroups = [...new Set(OBJECTS.map((entry) => entry.group))];

  if (!map) return <div className="map-studio-loading">{status}</div>;
  const hoverInBounds = Boolean(hover && hover.x >= 0 && hover.y >= 0 && hover.x < map.w && hover.y < map.h);

  return (
    <div className="map-studio">
      <header className="map-commandbar">
        <div className="map-title-block">
          <span>WORLD AUTHORING</span>
          <input value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} aria-label="Map name" />
          <small>{map.w}x{map.h} / {map.objects.length} placements</small>
        </div>
        <div className="map-history-controls">
          <button disabled={!historyRef.current.past.length} onClick={undo} title="Ctrl+Z">UNDO</button>
          <button disabled={!historyRef.current.future.length} onClick={redo} title="Ctrl+Y">REDO</button>
          <span className={dirty ? 'unsaved' : ''}>{dirty ? 'UNSAVED' : `DRAFT #${draftId ?? '-'}`}</span>
        </div>
        <div className="map-save-controls">
          <button onClick={() => void saveDraft()}>SAVE DRAFT</button>
          <button className="publish" disabled={validationErrors.length > 0} onClick={() => void publish()}>PUBLISH LIVE</button>
        </div>
      </header>

      <div className="map-studio-body">
        <aside className="map-palette">
          <div className="map-palette-tabs">
            <button className={palette === 'terrain' ? 'active' : ''} onClick={() => setPalette('terrain')}>TERRAIN</button>
            <button className={palette === 'resources' ? 'active' : ''} onClick={() => setPalette('resources')}>NODES</button>
            <button className={palette === 'blocks' ? 'active' : ''} onClick={() => setPalette('blocks')}>BLOCKS</button>
            <button className={palette === 'elevation' ? 'active' : ''} onClick={() => setPalette('elevation')}>HEIGHT</button>
            <button className={palette === 'objects' ? 'active' : ''} onClick={() => setPalette('objects')}>PLACEMENTS</button>
          </div>
          <div className="map-primary-tools">
            <button className={tool.mode === 'select' ? 'active' : ''} onClick={() => setTool({ mode: 'select' })}>V SELECT</button>
            <button className={tool.mode === 'pan' ? 'active' : ''} onClick={() => setTool({ mode: 'pan' })}>H PAN</button>
            <button className={tool.mode === 'erase' ? 'active danger' : ''} onClick={() => setTool({ mode: 'erase' })}>E ERASE</button>
          </div>

          {palette === 'terrain' ? (
            <div className="map-resource-palette"><div className="map-section-title">DB TERRAIN LIBRARY</div><p>Every cell is a published terrain ID. Pixel art, traversal, swimming, collision, sight, bullets, footsteps and minimap color come from its database definition.</p><div className="map-tool-list">{Object.entries(terrainDefs).map(([id, terrain]) => <button key={id} className={tool.mode === 'terrainDef' && tool.id === id ? 'active' : ''} onClick={() => setTool({ mode: 'terrainDef', id })}><i style={{ background: terrain.minimapColor }} />{terrain.name}<small>{terrain.spriteId} / {terrain.moveMultiplier}x speed</small></button>)}</div><label className="map-range">BRUSH <b>{brush}x{brush}</b><input type="range" min={1} max={5} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label></div>
          ) : palette === 'resources' ? (
            <div className="map-resource-palette"><div className="map-section-title">RESOURCE VARIANTS</div><p>Paint a published node definition. Health, drops, art, respawn and sounds come from the engine.</p><div className="map-tool-list">{Object.entries(resources).map(([id, resource]) => <button key={id} className={tool.mode === 'resource' && tool.id === id ? 'active' : ''} onClick={() => setTool({ mode: 'resource', id, tile: resource.tile as Tile })}><i style={{ background: resource.skill === 'woodcutting' ? '#42653b' : '#777a75' }} />{resource.name}<small>{resource.maxHits} HP / {resource.drops.length} drops</small></button>)}</div><label className="map-range">BRUSH <b>{brush}x{brush}</b><input type="range" min={1} max={5} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label></div>
          ) : palette === 'blocks' ? (
            <div className="map-resource-palette"><div className="map-section-title">ENGINE BLOCKS</div><p>Player-buildable kits and authored world blocks share this catalog. Pixel art, collision, bullets, sight, health, drops and sounds come from each block definition.</p>{tool.mode === 'block' ? <button className="map-library-add" onClick={() => setTool({ ...tool, rotation: (tool.rotation + 1) % 4 })}>ROTATE 90° · R · {tool.rotation * 90}°</button> : null}<div className="map-tool-list">{Object.entries(blocks).sort(([, a], [, b]) => Number(Boolean(b.playerPlacement)) - Number(Boolean(a.playerPlacement)) || a.name.localeCompare(b.name)).map(([id, block]) => <button key={id} className={tool.mode === 'block' && tool.id === id ? 'active' : ''} onClick={() => setTool({ mode: 'block', id, rotation: 0 })}><i style={{ background: block.playerPlacement ? '#b28c42' : block.collision.move ? '#8f6c38' : '#66775d' }} />{block.name}<small>{block.playerPlacement ? 'PLAYER BUILDABLE / ' : ''}{block.spriteId} / {block.destructible ? `${block.maxHp} HP` : 'INDESTRUCTIBLE'}</small></button>)}</div><label className="map-range">BRUSH <b>{brush}x{brush}</b><input type="range" min={1} max={5} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label></div>
          ) : palette === 'elevation' ? (
            <div className="map-elevation-palette"><div className="map-section-title">VERTICAL TERRAIN</div><p>Adjacent levels form walkable hills. A jump of two or more levels becomes a blocking cliff face.</p><div className="map-tool-list">{[0, 1, 2, 3].map((level) => <button key={level} className={tool.mode === 'elevation' && tool.level === level ? 'active' : ''} onClick={() => setTool({ mode: 'elevation', level })}><i style={{ background: `hsl(42 18% ${28 + level * 13}%)` }} />LEVEL {level}</button>)}</div><label className="map-range">BRUSH <b>{brush}x{brush}</b><input type="range" min={1} max={5} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label></div>
          ) : (
            <div className="map-object-palette">
              {objectGroups.map((group) => <div key={group}><div className="map-section-title">{group.toUpperCase()}</div><div className="map-tool-list">{OBJECTS.filter((entry) => entry.group === group).map((entry) => <button key={entry.id} className={tool.mode === 'object' && tool.id === entry.id ? 'active' : ''} onClick={() => setTool({ mode: 'object', id: entry.id, template: entry.template })}><i style={{ background: entry.color }} />{entry.label}</button>)}</div></div>)}
              <div className="map-section-title">CONTENT LIBRARY</div>
              <label className="map-select-label">MOB / BOSS<select value={customMob} onChange={(event) => setCustomMob(event.target.value)}>{Object.entries(mobs).map(([id, mob]) => <option key={id} value={id}>{mob.boss ? '[BOSS] ' : ''}{mob.name ?? id}</option>)}</select></label>
              <button className={`map-library-add${tool.mode === 'object' && tool.id === `mob:${customMob}` ? ' active' : ''}`} onClick={() => setTool(customMobTool())}>PLACE SELECTED MOB</button>
              <label className="map-select-label">CHEST LOOT TABLE<select value={customLoot} onChange={(event) => setCustomLoot(event.target.value)}>{Object.entries(loot).map(([id, table]) => <option key={id} value={id}>{table.name ?? id}</option>)}</select></label>
              <button className={`map-library-add${tool.mode === 'object' && tool.id === `loot:${customLoot}` ? ' active' : ''}`} onClick={() => setTool(customLootTool())}>PLACE CUSTOM CHEST</button>
            </div>
          )}
        </aside>

        <section className="map-viewport" ref={viewportRef}>
          <canvas
            ref={canvasRef}
            className={`map-live-canvas tool-${tool.mode}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
              event.preventDefault();
              if (event.shiftKey) {
                setCamera((current) => ({
                  ...current,
                  x: current.x + (event.deltaX + event.deltaY) / current.zoom,
                }));
                return;
              }
              const factor = Math.exp(-event.deltaY * 0.0015);
              const point = screenPoint(event.clientX, event.clientY);
              zoomAt(point.screenX, point.screenY, cameraRef.current.zoom * factor);
            }}
          />
          <div className="map-camera-controls">
            <button onClick={() => zoomAt(view.width / 2, view.height / 2, camera.zoom / 1.3)}>-</button>
            <span>{Math.round(camera.zoom * 100)}%</span>
            <button onClick={() => zoomAt(view.width / 2, view.height / 2, camera.zoom * 1.3)}>+</button>
            <button onClick={fitMap}>FIT</button>
          </div>
          <div className="map-layer-controls">
            <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> GRID</label>
            <label><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> LABELS</label>
            <label><input type="checkbox" checked={showZones} onChange={(event) => setShowZones(event.target.checked)} /> ZONES</label>
          </div>
          <div className="map-minimap-wrap">
            <canvas ref={minimapRef} onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const scale = Math.min(rect.width / map.w, rect.height / map.h);
              const ox = (rect.width - map.w * scale) / 2;
              const oy = (rect.height - map.h * scale) / 2;
              setCamera((current) => ({ ...current, x: clamp((event.clientX - rect.left - ox) / scale, 0, map.w) * TILE, y: clamp((event.clientY - rect.top - oy) / scale, 0, map.h) * TILE }));
            }} />
            <span>NAVIGATOR</span>
          </div>
          <div className="map-viewport-status">
            <span>{hoverInBounds && hover ? `${hover.x}, ${hover.y} / ${tileLabel(map.tiles[hover.y * map.w + hover.x])}` : 'Move over the map'}</span>
            <b>{tool.mode === 'pan' ? 'DRAG TO PAN' : 'MIDDLE OR SPACE+DRAG TO PAN'} / WHEEL ZOOM / SHIFT+WHEEL PAN</b>
          </div>
        </section>

        <aside className="map-inspector">
          <div className="map-inspector-head"><span>INSPECTOR</span>{selected && <button onClick={deleteSelected}>DELETE</button>}</div>
          {selected ? (
            <div className="map-inspector-form">
              <h3>{objectLabel(selected, mobs)}</h3>
              <small>{selected.type}</small>
              <div className="map-inspector-grid">
                <label>X<input type="number" min={0} max={map.w - 1} value={selected.x} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ x: clamp(Number(event.target.value) | 0, 0, map.w - 1) })} /></label>
                <label>Y<input type="number" min={0} max={map.h - 1} value={selected.y} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ y: clamp(Number(event.target.value) | 0, 0, map.h - 1) })} /></label>
              </div>
              {(selected.type.startsWith('poi_') || selected.type === 'trader') && <><label>DISPLAY NAME<input value={selected.name ?? ''} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ name: event.target.value })} /></label><label>ZONE RADIUS (TILES)<input type="number" min={2} max={40} value={selected.r ?? 8} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ r: clamp(Number(event.target.value) | 0, 2, 40) })} /></label></>}
              {selected.type === 'poi_zone' && <><label>ZONE CLASS<select value={selected.zoneKind ?? 'wilds'} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ zoneKind: event.target.value as MapObject['zoneKind'] })}><option value="wilds">WILDS</option><option value="town">TOWN</option><option value="airport">AIRPORT</option><option value="outpost">OUTPOST</option><option value="hotzone">HOT ZONE</option></select></label><div className="map-zone-flags"><label><input type="checkbox" checked={Boolean(selected.safe)} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ safe: event.target.checked })} /> SAFE ZONE</label><label><input type="checkbox" checked={Boolean(selected.hot)} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ hot: event.target.checked })} /> HOT LOOT</label></div></>}
              {selected.type === 'mob' && <><label>MOB RECORD<select value={selected.contentId ?? ''} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ contentId: event.target.value })}>{Object.entries(mobs).map(([id, mob]) => <option key={id} value={id}>{mob.name ?? id}</option>)}</select></label><label>RESPAWN SECONDS<input type="number" min={1} max={86400} value={Math.round((selected.respawnMs ?? 90_000) / 1000)} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ respawnMs: clamp(Number(event.target.value), 1, 86400) * 1000 })} /></label></>}
              {selected.type === 'chest_custom' && <label>LOOT TABLE<select value={selected.lootTable ?? ''} onFocus={beginInspectorEdit} onBlur={endInspectorEdit} onChange={(event) => updateSelected({ lootTable: event.target.value })}>{Object.entries(loot).map(([id, table]) => <option key={id} value={id}>{table.name ?? id}</option>)}</select></label>}
            </div>
          ) : (
            <div className="map-world-panel">
              <h3>WORLD SETTINGS</h3>
              <label>MAP SIZE</label>
              <div className="map-size-inputs"><input type="number" min={MIN_SIZE} max={MAX_SIZE} value={pendingW} onChange={(event) => setPendingW(Number(event.target.value))} /><span>x</span><input type="number" min={MIN_SIZE} max={MAX_SIZE} value={pendingH} onChange={(event) => setPendingH(Number(event.target.value))} /></div>
              <button onClick={applySize}>RESIZE WORLD</button>
              <div className="map-world-stats">
                <div><span>SPAWNS</span><b>{map.objects.filter((object) => object.type === 'spawn').length}</b></div>
                <div><span>EXTRACTS</span><b>{map.objects.filter((object) => object.type === 'extract').length}</b></div>
                <div><span>MOBS</span><b>{map.objects.filter((object) => ['zombie', 'military', 'deer', 'rabbit', 'boar', 'wolf', 'mob'].includes(object.type)).length}</b></div>
                <div><span>CHESTS</span><b>{map.objects.filter((object) => object.type.startsWith('chest')).length}</b></div>
              </div>
              <div className="map-revision-card"><span>LIVE REVISION</span><b>#{publishedId ?? 'NONE'}</b><small>Published worlds reload when empty.</small></div>
              <div className={`map-validation${validationErrors.length ? ' has-errors' : ''}`}><b>{validationErrors.length ? 'PUBLISH BLOCKERS' : 'VALIDATION READY'}</b>{validationErrors.length ? validationErrors.slice(0, 5).map((error, index) => <span key={`${index}:${error}`}>{error}</span>) : <span>All custom content references resolve.</span>}</div>
            </div>
          )}
        </aside>
      </div>
      <footer className="map-statusbar"><span>{status}</span><span>V Select / H Pan / E Erase / F Fit / Ctrl+Z Undo</span></footer>
    </div>
  );
}
