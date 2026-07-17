'use client';

import { useEffect, useRef } from 'react';
import type { CharacterAppearance } from '@holdout/shared';
import { drawCharacterAppearance } from '@/game/character-appearance';
import { loadSheets } from '@/game/sprites';

export function SurvivorPortrait({ appearance, label }: { appearance: CharacterAppearance; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSheets().then((sheets) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = 3;
      const left = 4;
      const top = 5;
      ctx.drawImage(sheets.chars, 0, appearance.outfit * 16, 16, 16, left, top, 16 * scale, 16 * scale);
      drawCharacterAppearance(ctx, appearance, left, top, scale);
    });
    return () => { cancelled = true; };
  }, [appearance]);

  return <canvas ref={canvasRef} className="survivor-portrait-canvas" width={56} height={56} role="img" aria-label={label} />;
}
