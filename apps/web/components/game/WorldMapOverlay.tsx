'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';

export const WORLD_MAP_SIZE = 768;
export const WORLD_MAP_MIN_ZOOM = 1;
export const WORLD_MAP_MAX_ZOOM = 16;
export const WORLD_MAP_DEFAULT_ZOOM = 2.5;

export interface WorldMapViewport {
  centerX: number;
  centerY: number;
  zoom: number;
}

export function constrainWorldMapViewport(viewport: WorldMapViewport, width: number, height: number): WorldMapViewport {
  const zoom = Math.max(WORLD_MAP_MIN_ZOOM, Math.min(WORLD_MAP_MAX_ZOOM, viewport.zoom));
  const span = Math.max(width, height) / zoom;
  const clampAxis = (center: number, length: number) => span >= length
    ? length / 2
    : Math.max(span / 2, Math.min(length - span / 2, center));
  return {
    centerX: clampAxis(viewport.centerX, width),
    centerY: clampAxis(viewport.centerY, height),
    zoom,
  };
}

export function WorldMapIcon() {
  return (
    <svg className="world-map-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 5 5-2 8 3 5-2v15l-5 2-8-3-5 2V5Z" />
      <path d="M8 3v15M16 6v15M5.5 13.5l3-2.5 3 2 3.5-4 3.5 2.5" />
    </svg>
  );
}

interface WorldMapOverlayProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  name: string;
  width: number;
  height: number;
  location: string | null;
  viewport: WorldMapViewport;
  getPlayerPosition: () => { x: number; y: number } | null;
  onViewportChange: (viewport: WorldMapViewport) => void;
  onClose: () => void;
}

export function WorldMapOverlay({
  canvasRef,
  name,
  width,
  height,
  location,
  viewport,
  getPlayerPosition,
  onViewportChange,
  onClose,
}: WorldMapOverlayProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewport: WorldMapViewport } | null>(null);
  const [dragging, setDragging] = useState(false);
  const maxDimension = Math.max(width, height);
  const constrained = constrainWorldMapViewport(viewport, width, height);
  const liveViewportRef = useRef(constrained);
  liveViewportRef.current = constrained;

  const commitViewport = (next: WorldMapViewport) => {
    const constrainedNext = constrainWorldMapViewport(next, width, height);
    liveViewportRef.current = constrainedNext;
    onViewportChange(constrainedNext);
  };

  const changeZoom = (nextZoom: number, anchor?: { x: number; y: number }) => {
    const current = liveViewportRef.current;
    const zoom = Math.max(WORLD_MAP_MIN_ZOOM, Math.min(WORLD_MAP_MAX_ZOOM, nextZoom));
    if (!anchor) {
      commitViewport({ ...current, zoom });
      return;
    }
    const oldSpan = maxDimension / current.zoom;
    const nextSpan = maxDimension / zoom;
    const tileX = current.centerX - oldSpan / 2 + anchor.x * oldSpan;
    const tileY = current.centerY - oldSpan / 2 + anchor.y * oldSpan;
    commitViewport({
      centerX: tileX + (0.5 - anchor.x) * nextSpan,
      centerY: tileY + (0.5 - anchor.y) * nextSpan,
      zoom,
    });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    changeZoom(liveViewportRef.current.zoom * (event.deltaY < 0 ? 1.35 : 1 / 1.35), {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport: liveViewportRef.current };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = chartRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !rect) return;
    const span = maxDimension / drag.viewport.zoom;
    commitViewport({
      ...drag.viewport,
      centerX: drag.viewport.centerX - ((event.clientX - drag.x) / rect.width) * span,
      centerY: drag.viewport.centerY - ((event.clientY - drag.y) / rect.height) * span,
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const centerPlayer = () => {
    const player = getPlayerPosition();
    if (!player) return;
    commitViewport({
      ...liveViewportRef.current,
      centerX: player.x,
      centerY: player.y,
      zoom: Math.max(2, liveViewportRef.current.zoom),
    });
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) return;
    centerPlayer();
  };

  const fitMap = () => commitViewport({ centerX: width / 2, centerY: height / 2, zoom: WORLD_MAP_MIN_ZOOM });
  const visibleTiles = Math.round(maxDimension / constrained.zoom);

  return (
    <div className="world-map-overlay" role="dialog" aria-modal="true" aria-label="World map">
      <section className="world-map-panel">
        <header className="world-map-head">
          <div>
            <span>TACTICAL SURVEY / LIVE POSITION</span>
            <h2>{name || 'FIELD MAP'}</h2>
          </div>
          <div className="world-map-meta">
            <span>{width} x {height} SECTORS</span>
            <b>{location ?? 'UNMARKED TERRITORY'}</b>
          </div>
          <button type="button" onClick={onClose} aria-label="Close map">CLOSE <kbd>M</kbd></button>
        </header>

        <div
          ref={chartRef}
          className={`world-map-chart${dragging ? ' dragging' : ''}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onDoubleClick={handleDoubleClick}
        >
          <canvas ref={canvasRef} width={WORLD_MAP_SIZE} height={WORLD_MAP_SIZE} aria-label={`${name} tactical map`} />
          <span className="world-map-corner north">N</span>
          <span className="world-map-corner scale">{constrained.zoom <= 1.01 ? 'FULL REGION' : `${visibleTiles} TILE WINDOW`}</span>
          <div className="world-map-tools" aria-label="Map navigation controls">
            <button type="button" onClick={() => changeZoom(constrained.zoom / 1.5)} disabled={constrained.zoom <= WORLD_MAP_MIN_ZOOM} aria-label="Zoom out">-</button>
            <b>{constrained.zoom.toFixed(1)}x</b>
            <button type="button" onClick={() => changeZoom(constrained.zoom * 1.5)} disabled={constrained.zoom >= WORLD_MAP_MAX_ZOOM} aria-label="Zoom in">+</button>
            <button type="button" onClick={centerPlayer}>PLAYER</button>
            <button type="button" onClick={fitMap}>FIT</button>
          </div>
          <span className="world-map-nav-hint">WHEEL TO ZOOM / DRAG TO PAN / DOUBLE-CLICK TO RECENTER</span>
        </div>

        <footer className="world-map-legend">
          <span><i className="you" />YOUR POSITION</span>
          <span><i className="friend" />ALLY</span>
          <span><i className="clan" />CLAN</span>
          <span><i className="safe" />SAFE ZONE</span>
          <span><i className="danger" />HIGH-LOOT ZONE</span>
          <span><i className="extract" />EXTRACTION</span>
          <span><i className="trader" />TRADER</span>
        </footer>
      </section>
    </div>
  );
}
