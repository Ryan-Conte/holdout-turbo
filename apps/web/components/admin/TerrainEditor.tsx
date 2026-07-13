'use client';

import { useEffect, useState } from 'react';
import { Tile, type EngineTerrainDefinition, type SoundDocument, type SpriteDocument, type TerrainDocument } from '@holdout/shared';

const NEW_TERRAIN: EngineTerrainDefinition = {
  id: 'new_terrain', name: 'New terrain', spriteId: 'terrain:mud', simulationTile: Tile.Grass, minimapColor: '#557c43', moveMultiplier: 1, swimmable: false,
  collision: { move: false, enemy: false, bullets: false, sight: false }, footstepSound: '',
};

export function TerrainEditor() {
  const [document, setDocument] = useState<TerrainDocument>({});
  const [sprites, setSprites] = useState<SpriteDocument>({ palette: [], assets: [] });
  const [sounds, setSounds] = useState<SoundDocument>({ presets: {}, actions: {} });
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading terrain definitions...');
  const terrain = document[selected];

  useEffect(() => { void Promise.all(['terrain', 'sprites', 'sounds'].map((kind) => fetch(`/api/admin/content/${kind}`, { cache: 'no-store' }).then((response) => response.json())))
    .then(([terrainData, spriteData, soundData]) => {
      const next = terrainData.draft && typeof terrainData.draft === 'object' ? terrainData.draft as TerrainDocument : {};
      setDocument(next); setSprites(spriteData.draft ?? { palette: [], assets: [] }); setSounds(soundData.draft ?? { presets: {}, actions: {} }); setSelected(Object.keys(next)[0] ?? ''); setMeta({ revision: terrainData.revision, publishedRevision: terrainData.publishedRevision }); setStatus('Terrain draft loaded');
    }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`)); }, []);

  const patch = (value: Partial<EngineTerrainDefinition>) => setDocument((current) => ({ ...current, [selected]: { ...current[selected], ...value, id: selected } }));
  const patchCollision = (key: keyof EngineTerrainDefinition['collision'], value: boolean) => patch({ collision: { ...terrain.collision, [key]: value } });
  const add = () => { const requested = window.prompt('Terrain id', 'new_terrain')?.trim().replace(/[^a-z0-9_-]/gi, '_'); if (!requested || document[requested]) return; setDocument((current) => ({ ...current, [requested]: { ...NEW_TERRAIN, id: requested, name: requested.replaceAll('_', ' ') } })); setSelected(requested); };
  const remove = () => { if (!terrain || !window.confirm(`Delete ${terrain.name}? Existing painted cells will lose this behavior.`)) return; const next = { ...document }; delete next[selected]; setDocument(next); setSelected(Object.keys(next)[0] ?? ''); };
  const visibleSprites = sprites.assets.filter((asset) => !search || `${asset.id} ${asset.name}`.toLowerCase().includes(search.toLowerCase()));

  const save = async (publish: boolean) => {
    setStatus('Validating terrain behavior and art links...');
    const response = await fetch('/api/admin/content/terrain', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: document }) });
    const data = await response.json(); if (!response.ok) { setStatus(data.error ?? 'Terrain save failed'); return; }
    if (!publish) { setMeta((current) => ({ ...current, revision: data.revision })); setStatus(`Terrain draft r${data.revision} saved`); return; }
    const live = await fetch('/api/admin/content/terrain', { method: 'POST' }); const liveData = await live.json();
    if (!live.ok) { setStatus(liveData.error ?? 'Publish failed'); return; }
    setMeta({ revision: data.revision, publishedRevision: liveData.publishedRevision }); setStatus(`Terrain revision ${liveData.publishedRevision} is live`);
  };

  return <section className="engine-editor"><header className="engine-editor-head"><div><div className="engine-kicker">DYNAMIC GROUND SYSTEM</div><h1>Terrain library</h1><p>Create reusable ground elements without changing the tile enum. Terrain maps directly to pixel art and controls traversal, swimming, collision, visibility, bullets, footsteps and minimap presentation.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="terrain-workbench"><aside className="engine-records"><div className="engine-record-toolbar"><b>{Object.keys(document).length} TERRAIN TYPES</b><button onClick={add}>+ NEW</button></div>{Object.entries(document).map(([id, entry]) => <button key={id} className={selected === id ? 'active' : ''} onClick={() => setSelected(id)}><i style={{ background: entry.minimapColor }} /><span>{entry.name}</span><small>{entry.moveMultiplier}x movement</small></button>)}</aside>
      {terrain ? <div className="terrain-form"><div className="mob-form-head"><div><span>TERRAIN ID</span><b>{selected}</b></div><button onClick={remove}>DELETE</button></div><div className="terrain-form-grid"><label>DISPLAY NAME<input value={terrain.name} onChange={(event) => patch({ name: event.target.value })} /></label><label>SIMULATION ROLE<select value={terrain.simulationTile} onChange={(event) => patch({ simulationTile: Number(event.target.value) })}><option value={Tile.Grass}>GROUND</option><option value={Tile.Water}>WATER SOURCE</option><option value={Tile.Sand}>SAND</option><option value={Tile.Road}>ROAD</option><option value={Tile.Asphalt}>ASPHALT</option><option value={Tile.Floor}>INTERIOR FLOOR</option><option value={Tile.Wall}>WALL</option><option value={Tile.Tree}>TREE NODE</option><option value={Tile.Rock}>ROCK NODE</option><option value={Tile.CopperOre}>COPPER NODE</option><option value={Tile.IronOre}>IRON NODE</option><option value={Tile.Cliff}>CLIFF</option><option value={Tile.DoorMat}>DOOR MAT</option><option value={Tile.Bed}>BED</option></select></label><label>MINIMAP COLOR<input type="color" value={terrain.minimapColor} onChange={(event) => patch({ minimapColor: event.target.value })} /></label><label>MOVEMENT MULTIPLIER<input type="number" min={0.05} max={5} step={0.05} value={terrain.moveMultiplier} onChange={(event) => patch({ moveMultiplier: Number(event.target.value) })} /></label><label>FOOTSTEP SOUND<select value={terrain.footstepSound ?? ''} onChange={(event) => patch({ footstepSound: event.target.value })}><option value="">Default footsteps</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name}</option>)}</select></label><label className="block-check"><input type="checkbox" checked={terrain.swimmable} onChange={(event) => patch({ swimmable: event.target.checked })} /> SWIMMABLE</label>{(['move', 'enemy', 'bullets', 'sight'] as const).map((key) => <label className="block-check" key={key}><input type="checkbox" checked={terrain.collision[key]} onChange={(event) => patchCollision(key, event.target.checked)} /> BLOCKS {key.toUpperCase()}</label>)}</div>
      <div className="block-sprite-picker"><div><span>GROUND PIXEL ART</span><b>{terrain.spriteId || 'NOT MAPPED'}</b></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pixel assets..." /><div>{visibleSprites.map((asset) => <button key={asset.id} className={terrain.spriteId === asset.id ? 'active' : ''} onClick={() => patch({ spriteId: asset.id })}><span>{asset.name}</span><small>{asset.id} / {asset.width}x{asset.height}</small></button>)}</div></div>
      <div className="terrain-behavior-note"><b>RUNTIME BEHAVIOR</b><span>Paint this ID from World &gt; Terrain elements. The server applies these rules per cell while legacy base tiles remain available underneath for backward compatibility.</span></div><div className="engine-actions"><span>{status}</span><button onClick={() => void save(false)}>SAVE DRAFT</button><button className="publish" onClick={() => void save(true)}>PUBLISH LIVE</button></div></div> : <div className="engine-empty">Create a terrain definition to begin.</div>}</div></section>;
}
