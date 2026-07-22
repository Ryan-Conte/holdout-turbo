import {
  CHARACTER_ACCENT_COLORS,
  CHARACTER_HAIR_COLORS,
  CHARACTER_OUTFIT_COLORS,
  CHARACTER_SKIN_COLORS,
  type CharacterAppearance,
} from '@holdout/shared';

/** Draw customizable layers over the current placeholder survivor sheet. */
export function drawCharacterAppearance(
  ctx: CanvasRenderingContext2D,
  appearance: CharacterAppearance,
  left: number,
  top: number,
  scale: number,
  helmet = false,
  frame = 0,
) {
  const skin = CHARACTER_SKIN_COLORS[appearance.skinTone] ?? CHARACTER_SKIN_COLORS[1];
  const hair = CHARACTER_HAIR_COLORS[appearance.hairColor] ?? CHARACTER_HAIR_COLORS[1];
  const outfit = CHARACTER_OUTFIT_COLORS[appearance.outfit] ?? CHARACTER_OUTFIT_COLORS[0];
  const accent = CHARACTER_ACCENT_COLORS[appearance.accent] ?? CHARACTER_ACCENT_COLORS[0];
  const shade = (color: string, factor: number) => `#${[1, 3, 5].map((offset) => Math.round(parseInt(color.slice(offset, offset + 2), 16) * factor).toString(16).padStart(2, '0')).join('')}`;
  const frameIndex = Math.max(0, Math.min(3, frame | 0));
  const liftedTop = top + (frameIndex === 2 ? -1 : 0) * scale;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(left + x * scale, liftedTop + y * scale, w * scale, h * scale);
  };

  // Repaint the base uniform so DB animation frames do not bake in one outfit.
  rect(4, 6, 8, 4, outfit);
  rect(4, 10, 8, 2, shade(outfit, 0.8));
  rect(3, 7 + (frameIndex === 1 ? 1 : frameIndex === 3 ? -1 : 0), 1, 4, outfit);
  rect(12, 7 + (frameIndex === 3 ? 1 : frameIndex === 1 ? -1 : 0), 1, 4, outfit);

  // Body frames retain the shared animation while changing the silhouette.
  if (appearance.body === 1) {
    rect(4, 7, 1, 4, outfit);
    rect(11, 7, 1, 4, outfit);
  } else if (appearance.body === 2) {
    rect(2, 7, 2, 4, outfit);
    rect(12, 7, 2, 4, outfit);
    rect(3, 6, 10, 2, outfit);
  }

  // Repaint the face so skin tone is independent from the source row.
  rect(5, 1, 6, 5, skin);
  if (!helmet) {
    // Cover legacy hair before drawing the selected style.
    rect(5, 0, 6, 2, skin);
    rect(4, 1, 1, 3, skin);
    rect(11, 1, 1, 3, skin);
    switch (appearance.hairStyle) {
      case 1: // crop
        rect(5, 0, 6, 2, hair); rect(4, 1, 1, 2, hair); break;
      case 2: // sidecut
        rect(6, 0, 5, 2, hair); rect(10, 2, 1, 2, hair); break;
      case 3: // mohawk
        rect(7, -1, 2, 4, hair); rect(6, 1, 4, 1, hair); break;
      case 4: // long
        rect(5, 0, 6, 2, hair); rect(4, 1, 2, 6, hair); rect(10, 1, 2, 6, hair); break;
      default: // shaved
        rect(5, 0, 6, 1, hair);
    }
  }
  rect(6, 3, 1, 1, '#1c1814');
  rect(9, 3, 1, 1, '#1c1814');

  // Accent is deliberately small so armor can naturally cover it.
  rect(6, 8, 4, 1, accent);
  rect(7, 9, 2, 1, accent);
}
