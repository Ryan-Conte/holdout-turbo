'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CHARACTER_ACCENT_COLORS,
  CHARACTER_BODY_NAMES,
  CHARACTER_HAIR_COLORS,
  CHARACTER_HAIR_NAMES,
  CHARACTER_OUTFIT_COLORS,
  CHARACTER_SKIN_COLORS,
  type CharacterAppearance,
} from '@holdout/shared';
import { drawCharacterAppearance } from '@/game/character-appearance';
import { loadSheets, type Sheets } from '@/game/sprites';

interface Props {
  callsign: string;
  value: CharacterAppearance;
  saving: boolean;
  error?: string;
  onChange: (appearance: CharacterAppearance) => void;
  onCancel: () => void;
  onSave: () => void;
}

function Swatches({ colors, value, onChange }: { colors: readonly string[]; value: number; onChange: (index: number) => void }) {
  return <div className="creator-swatches">{colors.map((color, index) => <button type="button" key={color} className={value === index ? 'active' : ''} style={{ '--swatch': color } as CSSProperties} onClick={() => onChange(index)} aria-label={`Color ${index + 1}`} />)}</div>;
}

export function CharacterCreator({ callsign, value, saving, error, onChange, onCancel, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const patch = (next: Partial<CharacterAppearance>) => onChange({ ...value, ...next });

  useEffect(() => { void loadSheets().then(setSheets); }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheets) return;
    let frameId = 0;
    const draw = (time: number) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gradient = ctx.createRadialGradient(140, 150, 10, 140, 150, 150);
      gradient.addColorStop(0, '#34392c'); gradient.addColorStop(1, '#11130f');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(140, 244, 65, 18, 0, 0, Math.PI * 2); ctx.fill();
      const scale = 10;
      const left = 60;
      const previewCycle = [0, 1, 2, 3, 2];
      const top = 65 + Math.sin(time / 420) * 1.5;
      const frame = previewCycle[Math.floor(time / 170) % previewCycle.length];
      ctx.drawImage(sheets.chars, frame * 16, value.outfit * 16, 16, 16, left, top, 16 * scale, 16 * scale);
      drawCharacterAppearance(ctx, value, left, top, scale, false, frame);
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [sheets, value]);

  return (
    <div className="character-creator-screen">
      <header className="creator-header"><div><span>PRE-DEPLOYMENT</span><h1>BUILD YOUR SURVIVOR</h1><p>Appearance is saved to your profile and follows you to every server.</p></div><button type="button" onClick={onCancel}>BACK TO BRIEFING</button></header>
      <div className="creator-workspace">
        <section className="creator-preview">
          <div className="creator-callsign"><span>CALLSIGN</span><b>{callsign}</b></div>
          <canvas ref={canvasRef} width={280} height={310} />
          <div className="creator-preview-note">LIVE PLACEHOLDER PREVIEW</div>
        </section>
        <section className="creator-controls">
          <div className="creator-control"><div><span>BODY FRAME</span><small>Silhouette</small></div><div className="creator-segments">{CHARACTER_BODY_NAMES.map((name, index) => <button type="button" key={name} className={value.body === index ? 'active' : ''} onClick={() => patch({ body: index })}>{name}</button>)}</div></div>
          <div className="creator-control"><div><span>SKIN TONE</span><small>Base layer</small></div><Swatches colors={CHARACTER_SKIN_COLORS} value={value.skinTone} onChange={(skinTone) => patch({ skinTone })} /></div>
          <div className="creator-control"><div><span>HAIR STYLE</span><small>Head layer</small></div><div className="creator-segments hair">{CHARACTER_HAIR_NAMES.map((name, index) => <button type="button" key={name} className={value.hairStyle === index ? 'active' : ''} onClick={() => patch({ hairStyle: index })}>{name}</button>)}</div></div>
          <div className="creator-control"><div><span>HAIR COLOR</span><small>Palette</small></div><Swatches colors={CHARACTER_HAIR_COLORS} value={value.hairColor} onChange={(hairColor) => patch({ hairColor })} /></div>
          <div className="creator-control"><div><span>FIELD OUTFIT</span><small>Sprite base</small></div><Swatches colors={CHARACTER_OUTFIT_COLORS} value={value.outfit} onChange={(outfit) => patch({ outfit })} /></div>
          <div className="creator-control"><div><span>ACCENT</span><small>Identity stripe</small></div><Swatches colors={CHARACTER_ACCENT_COLORS} value={value.accent} onChange={(accent) => patch({ accent })} /></div>
          <div className="creator-cosmetics"><div className="creator-section-label">COSMETIC SLOTS / READY FOR FUTURE CONTENT</div>{(['head', 'face', 'back', 'badge'] as const).map((slot) => <div key={slot}><span>{slot.toUpperCase()}</span><b>{value.cosmetics[slot] ?? 'EMPTY'}</b><small>NO ITEM EQUIPPED</small></div>)}</div>
        </section>
      </div>
      <footer className="creator-footer"><div><span>Gear and armor remain gameplay equipment. Cosmetic slots never change combat stats.</span>{error && <strong>{error}</strong>}</div><button type="button" className="btn-primary" disabled={saving} onClick={onSave}>{saving ? 'SAVING PROFILE...' : 'SAVE SURVIVOR'}</button></footer>
    </div>
  );
}
