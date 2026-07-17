import type { RuntimeVisualContent } from '@holdout/shared';

type RuntimeVisualAsset = RuntimeVisualContent['assets'][string];

let activeVisuals: RuntimeVisualContent = {
  assets: {}, animations: {}, resources: {}, sounds: { presets: {}, actions: {} }, mobSounds: {}, blocks: {}, terrain: {},
};

export function applyRuntimeVisuals(visuals: RuntimeVisualContent | null | undefined) {
  if (visuals) activeVisuals = visuals;
}

export function runtimeVisualAsset(id: string | undefined) {
  return id ? activeVisuals.assets[id] : undefined;
}

/** RGBA engine colors use the final byte for alpha. Black (#000000ff) is visible. */
export function runtimePixelVisible(color: string | null | undefined): boolean {
  if (!color || color === 'transparent') return false;
  const normalized = color.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized.slice(7) !== '00';
  return true;
}

/** Select a drawable database-authored frame, ignoring empty source placeholders. */
export function runtimeAssetFrame(asset: RuntimeVisualAsset | undefined): string[] | undefined {
  if (!asset) return undefined;
  const size = asset.width * asset.height;
  const candidates = [...(asset.frames ?? []), asset.pixels];
  return candidates.find((frame): frame is string[] =>
    Array.isArray(frame) && frame.length === size && frame.some(runtimePixelVisible),
  );
}
