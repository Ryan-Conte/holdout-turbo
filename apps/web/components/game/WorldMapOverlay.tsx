import type { RefObject } from 'react';

export const WORLD_MAP_SIZE = 768;

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
  onClose: () => void;
}

export function WorldMapOverlay({ canvasRef, name, width, height, location, onClose }: WorldMapOverlayProps) {
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

        <div className="world-map-chart">
          <canvas ref={canvasRef} width={WORLD_MAP_SIZE} height={WORLD_MAP_SIZE} aria-label={`${name} tactical map`} />
          <span className="world-map-corner north">N</span>
          <span className="world-map-corner scale">FULL REGION</span>
        </div>

        <footer className="world-map-legend">
          <span><i className="you" />YOUR POSITION</span>
          <span><i className="friend" />ALLY</span>
          <span><i className="safe" />SAFE ZONE</span>
          <span><i className="danger" />HIGH-LOOT ZONE</span>
          <span><i className="extract" />EXTRACTION</span>
          <span><i className="trader" />TRADER</span>
        </footer>
      </section>
    </div>
  );
}
