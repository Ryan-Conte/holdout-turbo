'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PixelAsset, SpriteDocument } from '@holdout/shared';

const EMPTY = '#00000000';
type PixelTool = 'pencil' | 'eraser' | 'fill' | 'dropper';

function rgbaHex(r: number, g: number, b: number, a: number): string {
  return `#${[r, g, b, a].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function validRgba(value: string): string {
  const next = value.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(next)) return next;
  if (/^#[0-9a-f]{6}$/.test(next)) return `${next}ff`;
  return '#000000ff';
}

function normalizedAsset(asset: PixelAsset): PixelAsset {
  const width = Math.max(1, Math.min(128, Math.floor(Number(asset.width) || 16)));
  const height = Math.max(1, Math.min(128, Math.floor(Number(asset.height) || 16)));
  const size = width * height;
  const legacyPixels = Array.isArray(asset.pixels) ? asset.pixels : [];
  const sourceFrames = Array.isArray(asset.frames) && asset.frames.length
    ? asset.frames
    : legacyPixels.length === size ? [legacyPixels] : [];
  const frames = sourceFrames
    .filter((frame): frame is string[] => Array.isArray(frame) && frame.length === size)
    .map((frame) => frame.slice());
  if (frames.length === 0) frames.push(new Array<string>(size).fill(EMPTY));
  return {
    ...asset,
    width,
    height,
    pixels: frames[0],
    frames,
    source: asset.source ? { ...asset.source, frames: asset.source.frames ?? (asset.source.sheet === 'chars' ? 2 : 1) } : undefined,
  };
}

function drawPixels(ctx: CanvasRenderingContext2D, pixels: string[], width: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  pixels.forEach((pixel, index) => {
    ctx.fillStyle = pixel;
    ctx.fillRect(index % width, Math.floor(index / width), 1, 1);
  });
  ctx.restore();
}

export function PixelEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<string[][]>([]);
  const lastPixelRef = useRef(-1);
  const [document, setDocument] = useState<SpriteDocument>({ palette: [EMPTY], assets: [] });
  const [selected, setSelected] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [assetSearch, setAssetSearch] = useState('');
  const [newFrameCount, setNewFrameCount] = useState(1);
  const [tool, setTool] = useState<PixelTool>('pencil');
  const [color, setColor] = useState('#eee7d2ff');
  const [onionSkin, setOnionSkin] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [previewMs, setPreviewMs] = useState(125);
  const [status, setStatus] = useState('Loading sprite document...');
  const [revision, setRevision] = useState(0);
  const asset = document.assets[selected];
  const frames = !asset
    ? []
    : asset.frames?.length
      ? asset.frames
      : Array.isArray(asset.pixels) && asset.pixels.length === asset.width * asset.height
        ? [asset.pixels]
        : [new Array<string>(asset.width * asset.height).fill(EMPTY)];
  const frame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))] ?? [];
  const pickerRgb = /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : '#000000';
  const pickerAlpha = /^#[0-9a-f]{8}$/i.test(color) ? parseInt(color.slice(7, 9), 16) : 255;
  const search = assetSearch.trim().toLowerCase();
  const visibleAssets = document.assets
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !search || `${entry.name} ${entry.id} ${entry.source?.sheet ?? ''}`.toLowerCase().includes(search));

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/content/sprites', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error ?? 'Could not load sprites'); return; }
    const draft = data.draft as SpriteDocument;
    const assets = draft.assets.map(normalizedAsset);
    if (!assets.some((entry) => entry.id === 'character:player')) assets.push(normalizedAsset({ id: 'character:player', name: 'Player base', width: 16, height: 16, pixels: [], source: { sheet: 'chars', col: 0, row: 0, frames: 2 } }));
    setDocument({ ...draft, assets });
    setRevision(data.revision);
    setStatus('Sprite draft loaded');
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setFrameIndex(0); historyRef.current = []; }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset) return;
    canvas.width = asset.width;
    canvas.height = asset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, asset.width, asset.height);
    if (onionSkin && frameIndex > 0) drawPixels(ctx, frames[frameIndex - 1], asset.width, 0.24);
    drawPixels(ctx, frame, asset.width);
  }, [asset, frame, frameIndex, frames, onionSkin]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !asset) return;
    canvas.width = asset.width;
    canvas.height = asset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let request = 0;
    const render = (time: number) => {
      const index = playing ? Math.floor(time / previewMs) % frames.length : frameIndex;
      ctx.clearRect(0, 0, asset.width, asset.height);
      drawPixels(ctx, frames[index] ?? frame, asset.width);
      request = requestAnimationFrame(render);
    };
    request = requestAnimationFrame(render);
    return () => cancelAnimationFrame(request);
  }, [asset, frame, frameIndex, frames, playing, previewMs]);

  const updateAsset = (nextAsset: PixelAsset) => setDocument((current) => ({
    ...current,
    assets: current.assets.map((entry, index) => index === selected ? normalizedAsset(nextAsset) : entry),
  }));

  const updateFrame = (pixels: string[]) => {
    if (!asset) return;
    const nextFrames = frames.map((entry, index) => index === frameIndex ? pixels : entry);
    updateAsset({ ...asset, pixels: nextFrames[0], frames: nextFrames });
  };

  const checkpoint = () => {
    historyRef.current.push(frame.slice());
    if (historyRef.current.length > 50) historyRef.current.shift();
  };

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (previous) updateFrame(previous);
  // updateFrame is intentionally current-selection scoped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIndex, selected, asset]);

  const importSource = async () => {
    if (!asset?.source) return;
    const image = new Image();
    image.src = `/sprites/${asset.source.sheet}.png`;
    await image.decode();
    const count = asset.source.frames ?? 1;
    const imported: string[][] = [];
    for (let sourceFrame = 0; sourceFrame < count; sourceFrame++) {
      const scratch = window.document.createElement('canvas');
      scratch.width = asset.width; scratch.height = asset.height;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      ctx.drawImage(image, (asset.source.col + sourceFrame) * 16, asset.source.row * 16, asset.width, asset.height, 0, 0, asset.width, asset.height);
      const rgba = ctx.getImageData(0, 0, asset.width, asset.height).data;
      const pixels: string[] = [];
      for (let i = 0; i < rgba.length; i += 4) pixels.push(rgbaHex(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]));
      imported.push(pixels);
    }
    if (imported.length) {
      updateAsset({ ...asset, pixels: imported[0], frames: imported });
      setFrameIndex(0);
      historyRef.current = [];
      setStatus(`Imported ${imported.length} frame(s) from ${asset.source.sheet}.png`);
    }
  };

  const floodFill = (pixels: string[], start: number, replacement: string) => {
    if (!asset) return pixels;
    const target = pixels[start];
    if (target === replacement) return pixels;
    const next = pixels.slice();
    const queue = [start];
    while (queue.length) {
      const index = queue.pop()!;
      if (next[index] !== target) continue;
      next[index] = replacement;
      const x = index % asset.width;
      if (x > 0) queue.push(index - 1);
      if (x < asset.width - 1) queue.push(index + 1);
      if (index >= asset.width) queue.push(index - asset.width);
      if (index < next.length - asset.width) queue.push(index + asset.width);
    }
    return next;
  };

  const pixelAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!asset) return -1;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) * asset.width / rect.width);
    const y = Math.floor((event.clientY - rect.top) * asset.height / rect.height);
    return x < 0 || y < 0 || x >= asset.width || y >= asset.height ? -1 : y * asset.width + x;
  };

  const applyTool = (event: React.PointerEvent<HTMLCanvasElement>, initial: boolean) => {
    if (!asset || (!initial && event.buttons === 0)) return;
    const index = pixelAt(event);
    if (index < 0 || index === lastPixelRef.current && !initial) return;
    lastPixelRef.current = index;
    const erase = event.button === 2 || (event.buttons & 2) !== 0 || tool === 'eraser';
    if (tool === 'dropper' && !erase) {
      setColor(validRgba(frame[index] ?? EMPTY));
      setStatus(`Sampled ${frame[index] ?? EMPTY}`);
      return;
    }
    if (initial) checkpoint();
    if (tool === 'fill' && !erase) updateFrame(floodFill(frame, index, validRgba(color)));
    else {
      const next = frame.slice();
      next[index] = erase ? EMPTY : validRgba(color);
      updateFrame(next);
    }
  };

  const addAsset = () => {
    const id = window.prompt('Sprite id', 'custom:new_sprite')?.trim();
    if (!id) return;
    const width = Math.max(8, Math.min(64, Number(window.prompt('Width in pixels (8-64)', '24')) || 24));
    const height = Math.max(8, Math.min(64, Number(window.prompt('Height in pixels (8-64)', '24')) || 24));
    const pixels = new Array<string>(width * height).fill(EMPTY);
    const next: PixelAsset = { id, name: id, width, height, pixels, frames: [pixels] };
    setDocument((current) => ({ ...current, assets: [...current.assets, next] }));
    setSelected(document.assets.length);
  };

  const addFrames = (blank: boolean) => {
    if (!asset) return;
    const count = Math.min(Math.max(1, newFrameCount | 0), 16, 64 - frames.length);
    if (count <= 0) { setStatus('This asset already has the maximum of 64 frames'); return; }
    const additions = Array.from({ length: count }, () => blank
      ? new Array<string>(asset.width * asset.height).fill(EMPTY)
      : frame.slice());
    updateAsset({ ...asset, frames: [...frames, ...additions] });
    setFrameIndex(frames.length);
    historyRef.current = [];
    setStatus(`Added ${count} ${blank ? 'blank' : 'duplicated'} frame${count === 1 ? '' : 's'} to ${asset.name}`);
  };

  const deleteFrame = () => {
    if (!asset || frames.length <= 1) return;
    const next = frames.filter((_, index) => index !== frameIndex);
    updateAsset({ ...asset, pixels: next[0], frames: next });
    setFrameIndex(Math.max(0, frameIndex - 1));
    historyRef.current = [];
  };

  const transformFrame = (mode: 'flip-x' | 'flip-y' | 'clear') => {
    if (!asset) return;
    checkpoint();
    if (mode === 'clear') { updateFrame(new Array<string>(asset.width * asset.height).fill(EMPTY)); return; }
    const next = new Array<string>(frame.length).fill(EMPTY);
    for (let y = 0; y < asset.height; y++) for (let x = 0; x < asset.width; x++) {
      const nx = mode === 'flip-x' ? asset.width - 1 - x : x;
      const ny = mode === 'flip-y' ? asset.height - 1 - y : y;
      next[ny * asset.width + nx] = frame[y * asset.width + x];
    }
    updateFrame(next);
  };

  const deleteAsset = () => {
    if (!asset || !window.confirm(`Delete sprite ${asset.name} and all ${frames.length} frame(s)?`)) return;
    setDocument((current) => ({ ...current, assets: current.assets.filter((_, index) => index !== selected) }));
    setSelected(Math.max(0, selected - 1)); setFrameIndex(0);
  };

  const updatePickerColor = (rgb: string) => setColor(`${rgb}${pickerAlpha.toString(16).padStart(2, '0')}`);
  const updatePickerAlpha = (alpha: number) => setColor(`${pickerRgb}${Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, '0')}`);
  const addPaletteColor = () => {
    const next = validRgba(color);
    setColor(next);
    setDocument((current) => current.palette.includes(next) ? current : { ...current, palette: [...current.palette, next].slice(-64) });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
      if (event.key.toLowerCase() === 'p') setTool('pencil');
      if (event.key.toLowerCase() === 'e') setTool('eraser');
      if (event.key.toLowerCase() === 'f') setTool('fill');
      if (event.key.toLowerCase() === 'i') setTool('dropper');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undo]);

  const save = async (publish: boolean) => {
    setStatus('Saving pixel and frame data to the database...');
    const saved = await fetch('/api/admin/content/sprites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: document }) });
    const saveData = await saved.json();
    if (!saved.ok) { setStatus(saveData.error ?? 'Sprite save failed'); return; }
    setRevision(saveData.revision);
    if (!publish) { setStatus(`Sprite draft revision ${saveData.revision} saved`); return; }
    const published = await fetch('/api/admin/content/sprites', { method: 'POST' });
    const publishData = await published.json();
    setStatus(published.ok ? `Sprite revision ${publishData.publishedRevision} published` : publishData.error);
  };

  return (
    <section className="engine-editor pixel-studio">
      <header className="engine-editor-head">
        <div><div className="engine-kicker">PIXEL + ANIMATION LAB</div><h1>Sprite workshop</h1><p>Draw RGBA art, build animation frames, preview movement, then publish reusable assets to the engine.</p></div>
        <div className="engine-revisions"><span>GRID {asset?.width ?? 0}x{asset?.height ?? 0} / {frames.length} FRAMES</span><small>draft r{revision}</small></div>
      </header>
      <div className="pixel-layout">
        <aside className="engine-records pixel-assets">
          <div className="engine-record-toolbar"><b>{document.assets.length} ASSETS</b><button onClick={addAsset}>+ NEW</button></div>
          <div className="pixel-asset-search"><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search name, ID or sheet..." aria-label="Search sprite assets" />{assetSearch && <button onClick={() => setAssetSearch('')}>CLEAR</button>}<small>{visibleAssets.length} MATCH{visibleAssets.length === 1 ? '' : 'ES'}</small></div>
          {visibleAssets.map(({ entry, index }) => <button className={selected === index ? 'active' : ''} key={entry.id} onClick={() => setSelected(index)}><span>{entry.name}</span><small>{entry.id} / {Math.max(1, entry.frames?.length ?? 1)}f</small></button>)}
          {visibleAssets.length === 0 && <div className="pixel-no-assets">NO ASSETS MATCH<br /><b>{assetSearch}</b></div>}
        </aside>
        <div className="pixel-canvas-panel">
          {asset ? <>
            <div className="pixel-title"><input value={asset.name} onChange={(event) => updateAsset({ ...asset, name: event.target.value })} /><span>{asset.id}</span><button className="pixel-delete" onClick={deleteAsset}>DELETE ASSET</button></div>
            <div className="pixel-tool-row">{(['pencil', 'eraser', 'fill', 'dropper'] as PixelTool[]).map((entry) => <button key={entry} className={tool === entry ? 'active' : ''} onClick={() => setTool(entry)}>{entry === 'dropper' ? 'EYEDROPPER (I)' : `${entry.toUpperCase()} (${entry[0].toUpperCase()})`}</button>)}<button onClick={undo}>UNDO</button><button onClick={() => transformFrame('flip-x')}>FLIP X</button><button onClick={() => transformFrame('flip-y')}>FLIP Y</button><button onClick={() => transformFrame('clear')}>CLEAR</button></div>
            <canvas ref={canvasRef} className="pixel-canvas" onPointerDown={(event) => { lastPixelRef.current = -1; applyTool(event, true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => applyTool(event, false)} onPointerUp={(event) => { lastPixelRef.current = -1; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onContextMenu={(event) => event.preventDefault()} />
            <div className="pixel-timeline"><div>{frames.map((_, index) => <button key={index} className={frameIndex === index ? 'active' : ''} onClick={() => { setFrameIndex(index); historyRef.current = []; }}>F{index + 1}</button>)}</div><button disabled={frames.length <= 1} onClick={deleteFrame}>DELETE CURRENT</button></div>
            <div className="pixel-frame-builder"><div><span>ADD EXTRA FRAMES</span><small>{frames.length}/64 USED</small></div><label>COUNT<input type="number" min={1} max={Math.min(16, Math.max(1, 64 - frames.length))} value={newFrameCount} onChange={(event) => setNewFrameCount(Math.max(1, Math.min(16, Number(event.target.value) || 1)))} /></label><button disabled={frames.length >= 64} onClick={() => addFrames(false)}>+ DUPLICATE CURRENT</button><button disabled={frames.length >= 64} onClick={() => addFrames(true)}>+ BLANK FRAMES</button></div>
            <div className="pixel-hint">Pencil / erase / flood fill / eyedropper. Right-drag erases. Ctrl+Z restores the current frame.</div>
          </> : <div className="engine-empty">Create or select a sprite asset.</div>}
        </div>
        <aside className="pixel-tools">
          <h3>ANIMATION PREVIEW</h3>
          <canvas ref={previewRef} className="pixel-preview" />
          <label>FRAME TIME <b>{previewMs}ms</b><input type="range" min={30} max={1000} step={5} value={previewMs} onChange={(event) => setPreviewMs(Number(event.target.value))} /></label>
          <div className="pixel-preview-options"><button onClick={() => setPlaying((value) => !value)}>{playing ? 'PAUSE' : 'PLAY'}</button><button className={onionSkin ? 'active' : ''} onClick={() => setOnionSkin((value) => !value)}>ONION SKIN</button></div>
          <h3>PALETTE</h3>
          <div className="pixel-palette">{document.palette.map((entry) => <button key={entry} className={color === entry ? 'active' : ''} style={{ background: entry }} onClick={() => setColor(entry)} title={entry} />)}</div>
          <div className="pixel-color-picker"><label>COLOR<input type="color" value={pickerRgb} onChange={(event) => updatePickerColor(event.target.value)} /></label><div className="pixel-color-preview" style={{ background: validRgba(color) }} title={validRgba(color)} /></div>
          <label>ALPHA <b>{Math.round(pickerAlpha / 255 * 100)}%</b><input type="range" min={0} max={255} value={pickerAlpha} onChange={(event) => updatePickerAlpha(Number(event.target.value))} /></label>
          <label>CUSTOM RGBA<input value={color} onChange={(event) => setColor(event.target.value)} onBlur={() => setColor(validRgba(color))} spellCheck={false} /></label>
          <button onClick={addPaletteColor}>+ ADD COLOR TO PALETTE</button>
          <button disabled={!asset?.source} onClick={importSource}>IMPORT PLACEHOLDER FRAMES</button>
          <button onClick={() => void save(false)}>SAVE DRAFT</button>
          <button className="publish" onClick={() => void save(true)}>PUBLISH LIVE</button>
          <p>{status}</p>
        </aside>
      </div>
    </section>
  );
}
