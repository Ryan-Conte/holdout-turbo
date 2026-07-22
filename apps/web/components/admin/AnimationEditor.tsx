'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ENTITY_ANIMATION_STATES,
  type AnimationClipDef,
  type AnimationDocument,
  type AnimationKeyframeDef,
  type EngineMobDefinition,
  type EntityAnimationProfile,
  type EntityAnimationState,
  type PixelAsset,
  type SoundDocument,
  type SpriteDocument,
} from '@holdout/shared';

const EMPTY = '#00000000';
const DEFAULT_CLIP: AnimationClipDef = { frames: [0], frameMs: 125, loop: true };
type PixelTool = 'pencil' | 'eraser' | 'fill' | 'dropper';

const sheetCache = new Map<string, Promise<HTMLImageElement>>();

function validRgba(value: string): string {
  const next = value.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(next)) return next;
  if (/^#[0-9a-f]{6}$/.test(next)) return `${next}ff`;
  return '#000000ff';
}

function rgbaHex(r: number, g: number, b: number, a: number): string {
  return `#${[r, g, b, a].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function assetFrames(asset?: PixelAsset): string[][] {
  if (!asset) return [];
  const size = asset.width * asset.height;
  const frames = Array.isArray(asset.frames) ? asset.frames : [];
  const valid = frames.filter((frame): frame is string[] => Array.isArray(frame) && frame.length === size);
  if (valid.length) return valid;
  return Array.isArray(asset.pixels) && asset.pixels.length === size ? [asset.pixels] : [];
}

function fallbackSourceFrameCount(asset?: PixelAsset): number {
  const configured = asset?.source?.frames ?? 1;
  return asset?.source?.sheet === 'chars' ? Math.max(4, configured) : configured;
}

function availableFrames(asset?: PixelAsset): number {
  return Math.max(1, assetFrames(asset).length || fallbackSourceFrameCount(asset));
}

function loadSheet(sheet: string): Promise<HTMLImageElement> {
  const existing = sheetCache.get(sheet);
  if (existing) return existing;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${sheet}.png`));
    image.src = `/sprites/${sheet}.png`;
  });
  sheetCache.set(sheet, pending);
  return pending;
}

async function drawAssetFrame(canvas: HTMLCanvasElement, asset: PixelAsset | undefined, frameIndex: number) {
  const width = Math.max(1, asset?.width ?? 16);
  const height = Math.max(1, asset?.height ?? 16);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  const frames = assetFrames(asset);
  const frame = frames[Math.max(0, Math.min(frames.length - 1, frameIndex))];
  if (frame) {
    frame.forEach((pixel, index) => {
      context.fillStyle = pixel;
      context.fillRect(index % width, Math.floor(index / width), 1, 1);
    });
    return;
  }
  if (!asset?.source) return;
  const image = await loadSheet(asset.source.sheet);
  const sourceFrame = Math.max(0, Math.min(fallbackSourceFrameCount(asset) - 1, frameIndex));
  context.drawImage(
    image,
    (asset.source.col + sourceFrame) * 16,
    asset.source.row * 16,
    asset.width,
    asset.height,
    0,
    0,
    asset.width,
    asset.height,
  );
}

function FrameCanvas({ asset, frame, className }: { asset?: PixelAsset; frame: number; className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void drawAssetFrame(ref.current, asset, frame);
  }, [asset, frame]);
  return <canvas ref={ref} className={className} />;
}

export function AnimationEditor() {
  const router = useRouter();
  const previewRef = useRef<HTMLCanvasElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const pixelHistoryRef = useRef<string[][]>([]);
  const lastPixelRef = useRef(-1);
  const [animations, setAnimations] = useState<AnimationDocument>({});
  const [mobs, setMobs] = useState<Record<string, EngineMobDefinition>>({});
  const [sprites, setSprites] = useState<SpriteDocument>({ palette: [], assets: [] });
  const [sounds, setSounds] = useState<SoundDocument>({ presets: {}, actions: {} });
  const [target, setTarget] = useState('player');
  const [state, setState] = useState<EntityAnimationState>('idle');
  const [previewStep, setPreviewStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [sourceFrame, setSourceFrame] = useState(0);
  const [assetSearch, setAssetSearch] = useState('');
  const [pixelTool, setPixelTool] = useState<PixelTool>('pencil');
  const [pixelColor, setPixelColor] = useState('#eee7d2ff');
  const [spriteDirty, setSpriteDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [spriteMeta, setSpriteMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading animation workspace...');

  const fallbackSprite = target === 'player' ? 'character:player' : mobs[target.slice(4)]?.spriteId ?? 'character:zombie';
  const profile: EntityAnimationProfile = animations[target] ?? { spriteId: fallbackSprite, clips: {} };
  const clip = profile.clips[state] ?? { ...DEFAULT_CLIP, loop: state !== 'death' };
  const sequence = clip.keyframes?.length ? clip.keyframes.map((keyframe) => keyframe.frame) : clip.frames.length ? clip.frames : [0];
  const keyframes: AnimationKeyframeDef[] = clip.keyframes?.length ? clip.keyframes : sequence.map((frame) => ({ frame, durationMs: clip.frameMs }));
  const selectedAsset = sprites.assets.find((asset) => asset.id === profile.spriteId);
  const customFrames = assetFrames(selectedAsset);
  const sourceFrameCount = availableFrames(selectedAsset);
  const editableFrame = customFrames[sourceFrame] ?? [];
  const previewSourceFrame = sequence[Math.min(previewStep, sequence.length - 1)] ?? 0;
  const pickerRgb = /^#[0-9a-f]{8}$/i.test(pixelColor) ? pixelColor.slice(0, 7) : '#000000';

  useEffect(() => {
    const read = async (kind: string) => {
      const response = await fetch(`/api/admin/content/${kind}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Could not load ${kind}`);
      return data;
    };
    void Promise.all([read('animations'), read('mobs'), read('sprites'), read('sounds')])
      .then(([animationData, mobData, spriteData, soundData]) => {
        setAnimations(animationData.draft ?? {});
        setMobs(mobData.draft ?? {});
        setSprites(spriteData.draft ?? { palette: [], assets: [] });
        setSounds(soundData.draft ?? { presets: {}, actions: {} });
        setMeta({ revision: animationData.revision, publishedRevision: animationData.publishedRevision });
        setSpriteMeta({ revision: spriteData.revision, publishedRevision: spriteData.publishedRevision });
        setStatus('Animation and sprite drafts loaded');
      })
      .catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  useEffect(() => {
    setPreviewStep(0);
    setSourceFrame(0);
    pixelHistoryRef.current = [];
  }, [target, state, profile.spriteId]);

  useEffect(() => {
    setSourceFrame((current) => Math.min(current, sourceFrameCount - 1));
    setPreviewStep((current) => Math.min(current, sequence.length - 1));
  }, [sequence.length, sourceFrameCount]);

  useEffect(() => {
    if (!playing || sequence.length <= 1) return;
    const timer = window.setTimeout(() => {
      setPreviewStep((current) => {
        if (current + 1 < sequence.length) return current + 1;
        return clip.loop ? 0 : current;
      });
    }, Math.max(16, keyframes[previewStep]?.durationMs ?? clip.frameMs));
    return () => window.clearTimeout(timer);
  }, [clip.frameMs, clip.loop, keyframes, playing, previewStep, sequence.length]);

  useEffect(() => {
    if (previewRef.current) void drawAssetFrame(previewRef.current, selectedAsset, previewSourceFrame);
  }, [previewSourceFrame, selectedAsset]);

  useEffect(() => {
    if (editCanvasRef.current) void drawAssetFrame(editCanvasRef.current, selectedAsset, sourceFrame);
  }, [selectedAsset, sourceFrame]);

  const patchProfile = (patch: Partial<EntityAnimationProfile>) => {
    setAnimations((current) => {
      const currentProfile = current[target] ?? { spriteId: fallbackSprite, clips: {} };
      return { ...current, [target]: { ...currentProfile, ...patch } };
    });
  };

  const patchClip = (clipState: EntityAnimationState, patch: Partial<AnimationClipDef>) => {
    setAnimations((current) => {
      const currentProfile = current[target] ?? { spriteId: fallbackSprite, clips: {} };
      const base = currentProfile.clips[clipState] ?? { ...DEFAULT_CLIP, loop: clipState !== 'death' };
      return {
        ...current,
        [target]: { ...currentProfile, clips: { ...currentProfile.clips, [clipState]: { ...base, ...patch } } },
      };
    });
  };

  const parseFrames = (value: string) => value.split(',')
    .map((part) => Number(part.trim()) | 0)
    .filter((frame) => frame >= 0 && frame <= 255)
    .slice(0, 128);

  const selectSprite = (spriteId: string) => {
    patchProfile({ spriteId });
    setSourceFrame(0);
    setPreviewStep(0);
  };

  const addTimelineFrame = () => {
    patchClip(state, { frames: [...sequence, sourceFrame], keyframes: [...keyframes, { frame: sourceFrame, durationMs: clip.frameMs }] });
    setPreviewStep(sequence.length);
    setPlaying(false);
  };

  const removeTimelineFrame = () => {
    if (sequence.length <= 1) return;
    const frames = sequence.filter((_, index) => index !== previewStep);
    patchClip(state, { frames, keyframes: keyframes.filter((_, index) => index !== previewStep) });
    setPreviewStep(Math.max(0, previewStep - 1));
  };

  const moveTimelineFrame = (direction: -1 | 1) => {
    const destination = previewStep + direction;
    if (destination < 0 || destination >= sequence.length) return;
    const frames = sequence.slice();
    const movedKeyframes = keyframes.slice();
    [frames[previewStep], frames[destination]] = [frames[destination], frames[previewStep]];
    [movedKeyframes[previewStep], movedKeyframes[destination]] = [movedKeyframes[destination], movedKeyframes[previewStep]];
    patchClip(state, { frames, keyframes: movedKeyframes });
    setPreviewStep(destination);
  };

  const patchKeyframe = (patch: Partial<AnimationKeyframeDef>) => {
    const next = keyframes.map((keyframe, index) => index === previewStep ? { ...keyframe, ...patch } : keyframe);
    patchClip(state, { frames: next.map((keyframe) => keyframe.frame), keyframes: next });
  };

  const updateSpriteFrame = (pixels: string[]) => {
    if (!selectedAsset || customFrames.length === 0) return;
    setSprites((current) => ({
      ...current,
      assets: current.assets.map((asset) => {
        if (asset.id !== selectedAsset.id) return asset;
        const frames = assetFrames(asset).map((frame, index) => index === sourceFrame ? pixels : frame);
        return { ...asset, pixels: frames[0], frames };
      }),
    }));
    setSpriteDirty(true);
  };

  const importSourceFrames = async () => {
    if (!selectedAsset) return;
    const frameCount = fallbackSourceFrameCount(selectedAsset);
    const imported: string[][] = [];
    if (selectedAsset.source) {
      const image = await loadSheet(selectedAsset.source.sheet);
      for (let index = 0; index < frameCount; index++) {
        const scratch = window.document.createElement('canvas');
        scratch.width = selectedAsset.width;
        scratch.height = selectedAsset.height;
        const context = scratch.getContext('2d', { willReadFrequently: true });
        if (!context) continue;
        context.drawImage(image, (selectedAsset.source.col + index) * 16, selectedAsset.source.row * 16, selectedAsset.width, selectedAsset.height, 0, 0, selectedAsset.width, selectedAsset.height);
        const rgba = context.getImageData(0, 0, selectedAsset.width, selectedAsset.height).data;
        const pixels: string[] = [];
        for (let pixel = 0; pixel < rgba.length; pixel += 4) pixels.push(rgbaHex(rgba[pixel], rgba[pixel + 1], rgba[pixel + 2], rgba[pixel + 3]));
        imported.push(pixels);
      }
    }
    if (imported.length === 0) imported.push(new Array<string>(selectedAsset.width * selectedAsset.height).fill(EMPTY));
    setSprites((current) => ({
      ...current,
      assets: current.assets.map((asset) => asset.id === selectedAsset.id ? { ...asset, pixels: imported[0], frames: imported } : asset),
    }));
    setSpriteDirty(true);
    setSourceFrame(0);
    setStatus(`${imported.length} editable frame(s) prepared for ${selectedAsset.name}`);
  };

  const floodFill = (pixels: string[], start: number, replacement: string): string[] => {
    if (!selectedAsset) return pixels;
    const targetColor = pixels[start];
    if (targetColor === replacement) return pixels;
    const next = pixels.slice();
    const queue = [start];
    while (queue.length) {
      const index = queue.pop()!;
      if (next[index] !== targetColor) continue;
      next[index] = replacement;
      const x = index % selectedAsset.width;
      if (x > 0) queue.push(index - 1);
      if (x < selectedAsset.width - 1) queue.push(index + 1);
      if (index >= selectedAsset.width) queue.push(index - selectedAsset.width);
      if (index < next.length - selectedAsset.width) queue.push(index + selectedAsset.width);
    }
    return next;
  };

  const pixelAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selectedAsset) return -1;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * selectedAsset.width / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * selectedAsset.height / bounds.height);
    return x < 0 || y < 0 || x >= selectedAsset.width || y >= selectedAsset.height ? -1 : y * selectedAsset.width + x;
  };

  const applyPixelTool = (event: React.PointerEvent<HTMLCanvasElement>, initial: boolean) => {
    if (!selectedAsset || editableFrame.length === 0 || (!initial && event.buttons === 0)) return;
    const index = pixelAt(event);
    if (index < 0 || (!initial && index === lastPixelRef.current)) return;
    lastPixelRef.current = index;
    const erase = event.button === 2 || (event.buttons & 2) !== 0 || pixelTool === 'eraser';
    if (pixelTool === 'dropper' && !erase) {
      setPixelColor(validRgba(editableFrame[index] ?? EMPTY));
      return;
    }
    if (initial) {
      pixelHistoryRef.current.push(editableFrame.slice());
      if (pixelHistoryRef.current.length > 30) pixelHistoryRef.current.shift();
    }
    if (pixelTool === 'fill' && !erase) updateSpriteFrame(floodFill(editableFrame, index, validRgba(pixelColor)));
    else {
      const pixels = editableFrame.slice();
      pixels[index] = erase ? EMPTY : validRgba(pixelColor);
      updateSpriteFrame(pixels);
    }
  };

  const undoPixel = () => {
    const previous = pixelHistoryRef.current.pop();
    if (previous) updateSpriteFrame(previous);
  };

  const save = async (publish: boolean) => {
    setSaving(true);
    setStatus(publish ? 'Publishing animation and pixel revisions...' : 'Saving animation workspace...');
    try {
      let spritesChanged = spriteDirty;
      if (spritesChanged) {
        const response = await fetch('/api/admin/content/sprites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: sprites }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Sprite save failed');
        setSpriteMeta((current) => ({ ...current, revision: data.revision }));
        setSpriteDirty(false);
      }
      const response = await fetch('/api/admin/content/animations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: animations }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Animation save failed');
      setMeta((current) => ({ ...current, revision: data.revision }));
      if (!publish) {
        setStatus(`Workspace saved: animation r${data.revision}${spritesChanged ? ' + sprite draft' : ''}`);
        return;
      }
      if (spritesChanged) {
        const spritePublish = await fetch('/api/admin/content/sprites', { method: 'POST' });
        const spriteData = await spritePublish.json();
        if (!spritePublish.ok) throw new Error(spriteData.error ?? 'Sprite publish failed');
        setSpriteMeta((current) => ({ ...current, publishedRevision: spriteData.publishedRevision }));
      }
      const animationPublish = await fetch('/api/admin/content/animations', { method: 'POST' });
      const animationData = await animationPublish.json();
      if (!animationPublish.ok) throw new Error(animationData.error ?? 'Animation publish failed');
      setMeta({ revision: data.revision, publishedRevision: animationData.publishedRevision });
      setStatus(`Animation r${animationData.publishedRevision} is live${spritesChanged ? ' with updated pixel art' : ''}`);
    } catch (error) {
      setStatus(`Save failed: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const targets = [{ id: 'player', name: 'PLAYER' }, ...Object.entries(mobs).map(([id, mob]) => ({ id: `mob:${id}`, name: mob.name }))];
  const search = assetSearch.trim().toLowerCase();
  const visibleAssets = sprites.assets.filter((asset) => !search || `${asset.id} ${asset.name}`.toLowerCase().includes(search));
  const duration = keyframes.reduce((sum, keyframe) => sum + keyframe.durationMs, 0);

  return (
    <section className="engine-editor animation-studio">
      <header className="engine-editor-head">
        <div><div className="engine-kicker">MOTION + PIXEL LAB</div><h1>Animation studio</h1><p>Build state clips visually, scrub their timing, select source art, and edit individual pixel frames without leaving the workspace.</p></div>
        <div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision || spriteDirty ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision || spriteDirty ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>motion r{meta.revision}/{meta.publishedRevision} / art r{spriteMeta.revision}/{spriteMeta.publishedRevision}</small></div>
      </header>

      <div className="animation-workbench">
        <aside className="engine-records animation-targets">
          <div className="engine-record-toolbar"><b>{targets.length} TARGETS</b></div>
          {targets.map((entry) => <button key={entry.id} className={target === entry.id ? 'active' : ''} onClick={() => setTarget(entry.id)}><span>{entry.name}</span><small>{entry.id}</small></button>)}
        </aside>

        <div className="animation-panel">
          <div className="animation-target-head">
            <div><span>ANIMATION TARGET</span><b>{target}</b></div>
            <div className="animation-head-stats"><span>{selectedAsset?.name ?? profile.spriteId}</span><b>{sourceFrameCount} SOURCE FRAMES / {duration}MS CLIP</b></div>
          </div>

          <div className="animation-state-tabs">
            {ENTITY_ANIMATION_STATES.map((entry) => <button key={entry} className={state === entry ? 'active' : ''} onClick={() => setState(entry)}><span>{entry.toUpperCase()}</span><small>{profile.clips[entry]?.frames.length ?? 1}f</small></button>)}
          </div>

          <div className="animation-studio-grid">
            <div className="animation-sequence-panel">
              <div className="animation-preview-stage">
                <div className="animation-stage-grid" />
                <canvas ref={previewRef} className="animation-main-preview" />
                <div className="animation-preview-label"><span>{state.toUpperCase()}</span><b>SOURCE F{previewSourceFrame + 1}</b></div>
              </div>

              <div className="animation-transport">
                <button onClick={() => { setPreviewStep(0); setPlaying(false); }}>START</button>
                <button className="primary" onClick={() => setPlaying((current) => !current)}>{playing ? 'PAUSE' : 'PLAY'}</button>
                <span>{previewStep + 1} / {sequence.length}</span>
                <div><i style={{ width: `${((previewStep + 1) / sequence.length) * 100}%` }} /></div>
                <b>{duration} MS</b>
              </div>

              <div className="animation-timeline-head"><div><span>KEYFRAME TIMELINE</span><b>{state.toUpperCase()}</b></div><small>Selected step can carry timing, event and sound</small></div>
              <div className="animation-timeline">
                {sequence.map((frameId, index) => (
                  <button key={`${index}:${frameId}`} className={previewStep === index ? 'active' : ''} style={{ '--frame-weight': Math.max(72, Math.min(170, keyframes[index].durationMs / 2)) } as React.CSSProperties} onClick={() => { setPreviewStep(index); setPlaying(false); }}>
                    <FrameCanvas asset={selectedAsset} frame={frameId} className="animation-frame-thumb" />
                    <span>STEP {index + 1} / {keyframes[index].durationMs}MS</span><b>F{frameId + 1}</b>
                  </button>
                ))}
                <button className="animation-add-step" onClick={addTimelineFrame}>+ ADD F{sourceFrame + 1}</button>
              </div>

              <div className="animation-timeline-tools">
                <button disabled={previewStep === 0} onClick={() => moveTimelineFrame(-1)}>MOVE LEFT</button>
                <button disabled={previewStep >= sequence.length - 1} onClick={() => moveTimelineFrame(1)}>MOVE RIGHT</button>
                <button disabled={sequence.length <= 1} onClick={removeTimelineFrame}>REMOVE STEP</button>
              </div>

              <div className="animation-clip-settings">
                <label>DEFAULT FRAME TIME<input type="number" min={16} max={10000} value={clip.frameMs} onChange={(event) => patchClip(state, { frameMs: Number(event.target.value) })} /></label>
                <label>FRAME ORDER<input key={`${target}:${state}:${sequence.join('-')}`} defaultValue={sequence.join(', ')} onBlur={(event) => { const frames = parseFrames(event.target.value); const safe = frames.length ? frames : [0]; patchClip(state, { frames: safe, keyframes: safe.map((frame, index) => ({ ...(keyframes[index] ?? { durationMs: clip.frameMs }), frame })) }); setPreviewStep(0); }} /></label>
                <label className="animation-loop"><input type="checkbox" checked={clip.loop} onChange={(event) => patchClip(state, { loop: event.target.checked })} /> LOOP CLIP</label>
                <label>SELECTED DURATION<input type="number" min={16} max={10000} value={keyframes[previewStep]?.durationMs ?? clip.frameMs} onChange={(event) => patchKeyframe({ durationMs: Number(event.target.value) })} /></label>
                <label>KEYFRAME SOUND<select value={keyframes[previewStep]?.soundId ?? ''} onChange={(event) => patchKeyframe({ soundId: event.target.value || undefined })}><option value="">No sound cue</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name} / {id}</option>)}</select></label>
                <label>EVENT MARKER<input value={keyframes[previewStep]?.event ?? ''} onChange={(event) => patchKeyframe({ event: event.target.value || undefined })} placeholder="impact, footstep..." /></label>
              </div>
            </div>

            <aside className="animation-art-panel">
              <div className="animation-art-head"><div><span>SPRITE SOURCE</span><b>{selectedAsset?.id ?? profile.spriteId}</b></div><button onClick={() => router.push('/admin/sprites')}>FULL PIXEL LAB</button></div>
              <input className="animation-asset-search" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Filter sprite assets..." />
              <div className="animation-asset-grid">
                {visibleAssets.map((asset) => <button key={asset.id} className={profile.spriteId === asset.id ? 'active' : ''} onClick={() => selectSprite(asset.id)} title={asset.id}><FrameCanvas asset={asset} frame={0} className="animation-asset-thumb" /><span>{asset.name}</span><small>{availableFrames(asset)}f</small></button>)}
              </div>

              <div className="animation-source-head"><span>SOURCE FRAMES</span><small>Select art, then add it to the timeline</small></div>
              <div className="animation-source-frames">
                {Array.from({ length: sourceFrameCount }, (_, index) => <button key={index} className={sourceFrame === index ? 'active' : ''} onClick={() => setSourceFrame(index)}><FrameCanvas asset={selectedAsset} frame={index} className="animation-source-thumb" /><span>F{index + 1}</span></button>)}
              </div>

              <div className="animation-pixel-head"><div><span>INLINE FRAME EDITOR</span><b>{customFrames.length ? `F${sourceFrame + 1}` : 'SOURCE LOCKED'}</b></div>{spriteDirty && <small>ART MODIFIED</small>}</div>
              <canvas
                ref={editCanvasRef}
                className={`animation-pixel-canvas${customFrames.length ? '' : ' locked'}`}
                onPointerDown={(event) => { lastPixelRef.current = -1; applyPixelTool(event, true); if (customFrames.length) event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={(event) => applyPixelTool(event, false)}
                onPointerUp={(event) => { lastPixelRef.current = -1; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onContextMenu={(event) => event.preventDefault()}
              />
              {customFrames.length === 0 ? <button className="animation-import-art" disabled={!selectedAsset} onClick={() => void importSourceFrames()}>{selectedAsset?.source ? 'IMPORT PLACEHOLDER FRAMES TO EDIT' : 'CREATE EDITABLE FRAME'}</button> : <>
                <div className="animation-pixel-tools">
                  {(['pencil', 'eraser', 'fill', 'dropper'] as PixelTool[]).map((tool) => <button key={tool} className={pixelTool === tool ? 'active' : ''} onClick={() => setPixelTool(tool)}>{tool.toUpperCase()}</button>)}
                  <button onClick={undoPixel}>UNDO</button>
                  <button onClick={() => { pixelHistoryRef.current.push(editableFrame.slice()); updateSpriteFrame(new Array<string>(editableFrame.length).fill(EMPTY)); }}>CLEAR</button>
                </div>
                <div className="animation-color-row"><input type="color" value={pickerRgb} onChange={(event) => setPixelColor(`${event.target.value}${pixelColor.slice(7, 9) || 'ff'}`)} /><input value={pixelColor} onChange={(event) => setPixelColor(event.target.value)} onBlur={() => setPixelColor(validRgba(pixelColor))} /></div>
                <div className="animation-mini-palette">{sprites.palette.slice(0, 18).map((color) => <button key={color} className={validRgba(pixelColor) === color ? 'active' : ''} style={{ background: color }} onClick={() => setPixelColor(color)} title={color} />)}</div>
              </>}
            </aside>
          </div>

          <div className="engine-actions"><span>{status}</span><button disabled={saving} onClick={() => void save(false)}>SAVE WORKSPACE</button><button className="publish" disabled={saving} onClick={() => void save(true)}>PUBLISH MOTION + ART</button></div>
        </div>
      </div>
    </section>
  );
}
