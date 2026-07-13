'use client';

import { useEffect, useState } from 'react';
import { BUILDABLES, ITEMS, type BlockDocument, type BuildType, type EngineBlockDefinition, type SoundDocument, type SpriteDocument } from '@holdout/shared';

const NEW_BLOCK: EngineBlockDefinition = {
  id: 'new_block', name: 'New world block', spriteId: 'block:steel_crate', scale: 1, offsetY: 0,
  maxHp: 100, destructible: true, collision: { move: true, enemy: true, bullets: true, sight: true },
  hitSound: 'mine', breakSound: 'rock_break', drops: [{ itemId: 'scrap', min: 1, max: 3, chance: 1, when: 'depleted' }],
};

export function BlockEditor() {
  const [document, setDocument] = useState<BlockDocument>({ version: 1, world: {} });
  const [sprites, setSprites] = useState<SpriteDocument>({ palette: [], assets: [] });
  const [sounds, setSounds] = useState<SoundDocument>({ presets: {}, actions: {} });
  const [selected, setSelected] = useState('');
  const [spriteSearch, setSpriteSearch] = useState('');
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading world blocks...');
  const block = document.world[selected];

  useEffect(() => {
    void Promise.all(['blocks', 'sprites', 'sounds'].map((kind) => fetch(`/api/admin/content/${kind}`, { cache: 'no-store' }).then((response) => response.json())))
      .then(([blockData, spriteData, soundData]) => {
        const draft = blockData.draft as Partial<BlockDocument>;
        const next: BlockDocument = { version: 1, world: draft.world ?? {}, legacyBuildables: draft.legacyBuildables ?? (!draft.world ? draft : undefined) };
        setDocument(next); setSprites(spriteData.draft ?? { palette: [], assets: [] }); setSounds(soundData.draft ?? { presets: {}, actions: {} });
        setSelected(Object.keys(next.world)[0] ?? ''); setMeta({ revision: blockData.revision, publishedRevision: blockData.publishedRevision }); setStatus('Block draft loaded');
      }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  const patch = (value: Partial<EngineBlockDefinition>) => {
    if (!block) return;
    setDocument((current) => ({ ...current, world: { ...current.world, [selected]: { ...current.world[selected], ...value, id: selected } } }));
  };
  const add = () => { const id = window.prompt('World block id', 'new_block')?.trim().replace(/[^a-z0-9_-]/gi, '_'); if (!id || document.world[id]) return; setDocument((current) => ({ ...current, world: { ...current.world, [id]: { ...NEW_BLOCK, id, name: id.replaceAll('_', ' ') } } })); setSelected(id); };
  const remove = () => { if (!block || !window.confirm(`Delete ${block.name}? Maps using it will fail validation.`)) return; const world = { ...document.world }; delete world[selected]; setDocument({ ...document, world }); setSelected(Object.keys(world)[0] ?? ''); };
  const patchCollision = (key: keyof EngineBlockDefinition['collision'], value: boolean) => patch({ collision: { ...block.collision, [key]: value } });
  const setPlayerPlaceable = (enabled: boolean) => {
    if (!enabled) { patch({ playerPlacement: undefined }); return; }
    const buildType: BuildType = 'wall'; const buildable = BUILDABLES[buildType];
    const kit = Object.values(ITEMS).find((item) => item.place === buildType)!;
    patch({ playerPlacement: { buildType, kitItemId: kit.id, simulationTile: buildable.tile, hideoutOnly: Boolean(buildable.hideoutOnly), foundation: false, storageSlots: 0 } });
  };
  const setBuildType = (buildType: BuildType) => {
    const buildable = BUILDABLES[buildType]; const kit = Object.values(ITEMS).find((item) => item.place === buildType)!;
    patch({ playerPlacement: { ...block.playerPlacement!, buildType, kitItemId: kit.id, simulationTile: buildable.tile, hideoutOnly: Boolean(buildable.hideoutOnly), foundation: buildType === 'wood_floor' || buildType === 'stone_floor', storageSlots: buildType === 'chest' ? 12 : 0 } });
  };
  const patchDrop = (index: number, value: Partial<EngineBlockDefinition['drops'][number]>) => patch({ drops: block.drops.map((drop, at) => at === index ? { ...drop, ...value } : drop) });
  const spriteFilter = spriteSearch.trim().toLowerCase();
  const visibleSprites = sprites.assets.filter((asset) => !spriteFilter || `${asset.name} ${asset.id}`.toLowerCase().includes(spriteFilter));

  const save = async (publish: boolean) => {
    setStatus('Validating block behavior and sprite links...');
    const response = await fetch('/api/admin/content/blocks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: document }) });
    const data = await response.json(); if (!response.ok) { setStatus(data.error ?? 'Block save failed'); return; }
    setMeta((current) => ({ ...current, revision: data.revision }));
    if (!publish) { setStatus(`Block draft r${data.revision} saved`); return; }
    const published = await fetch('/api/admin/content/blocks', { method: 'POST' }); const publishedData = await published.json();
    if (published.ok) setMeta({ revision: data.revision, publishedRevision: publishedData.publishedRevision });
    setStatus(published.ok ? `Block revision ${publishedData.publishedRevision} is live` : publishedData.error);
  };

  return <section className="engine-editor"><header className="engine-editor-head"><div><div className="engine-kicker">DYNAMIC WORLD GEOMETRY</div><h1>World blocks</h1><p>Create world geometry without adding tile enums. Map-authored main-world blocks are protected; health, destructibility and drops apply to player-placed structures and non-world uses.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="block-workbench"><aside className="engine-records"><div className="engine-record-toolbar"><b>{Object.keys(document.world).length} BLOCKS</b><button onClick={add}>+ NEW</button></div>{Object.entries(document.world).map(([id, entry]) => <button key={id} className={selected === id ? 'active' : ''} onClick={() => setSelected(id)}><span>{entry.name}{entry.playerPlacement ? ' [BUILDABLE]' : ''}</span><small>{entry.spriteId}</small></button>)}</aside>
      {block ? <div className="block-form"><div className="mob-form-head"><div><span>BLOCK ID</span><b>{selected}</b></div><button onClick={remove}>DELETE</button></div><div className="block-form-grid">
        <label>DISPLAY NAME<input value={block.name} onChange={(event) => patch({ name: event.target.value })} /></label><label>MAX HEALTH<input type="number" min={1} max={1000000} value={block.maxHp} onChange={(event) => patch({ maxHp: Number(event.target.value) })} /></label><label className="block-check"><input type="checkbox" checked={block.destructible} onChange={(event) => patch({ destructible: event.target.checked })} /> DESTRUCTIBLE</label><label className="block-check"><input type="checkbox" checked={Boolean(block.playerPlacement)} onChange={(event) => setPlayerPlaceable(event.target.checked)} /> PLAYER PLACEABLE</label>
        <label>RENDER SCALE<input type="number" min={0.1} max={8} step={0.1} value={block.scale} onChange={(event) => patch({ scale: Number(event.target.value) })} /></label><label>VERTICAL OFFSET<input type="number" min={-256} max={256} value={block.offsetY} onChange={(event) => patch({ offsetY: Number(event.target.value) })} /></label>
        {(['move', 'enemy', 'bullets', 'sight'] as const).map((key) => <label className="block-check" key={key}><input type="checkbox" checked={block.collision[key]} onChange={(event) => patchCollision(key, event.target.checked)} /> BLOCKS {key.toUpperCase()}</label>)}
        <label>HIT SOUND<select value={block.hitSound ?? ''} onChange={(event) => patch({ hitSound: event.target.value })}><option value="">No sound</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name}</option>)}</select></label><label>BREAK SOUND<select value={block.breakSound ?? ''} onChange={(event) => patch({ breakSound: event.target.value })}><option value="">No sound</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name}</option>)}</select></label>
        {block.playerPlacement ? <><label>BUILD TYPE<select value={block.playerPlacement.buildType} onChange={(event) => setBuildType(event.target.value as BuildType)}>{Object.entries(BUILDABLES).map(([id, buildable]) => <option key={id} value={id}>{buildable.name}</option>)}</select></label><label>KIT ITEM<select value={block.playerPlacement.kitItemId} onChange={(event) => patch({ playerPlacement: { ...block.playerPlacement!, kitItemId: event.target.value as keyof typeof ITEMS } })}>{Object.entries(ITEMS).filter(([, item]) => item.place).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label><label className="block-check"><input type="checkbox" checked={block.playerPlacement.hideoutOnly} onChange={(event) => patch({ playerPlacement: { ...block.playerPlacement!, hideoutOnly: event.target.checked } })} /> HIDEOUT ONLY</label><label className="block-check"><input type="checkbox" checked={block.playerPlacement.foundation} onChange={(event) => patch({ playerPlacement: { ...block.playerPlacement!, foundation: event.target.checked } })} /> FOUNDATION</label><label>STORAGE SLOTS<input type="number" min={0} max={1000} value={block.playerPlacement.storageSlots} onChange={(event) => patch({ playerPlacement: { ...block.playerPlacement!, storageSlots: Number(event.target.value) } })} /></label></> : null}
      </div><div className="block-sprite-picker"><div><span>PIXEL ART ASSET</span><b>{block.spriteId || 'NOT MAPPED'}</b></div><input value={spriteSearch} onChange={(event) => setSpriteSearch(event.target.value)} placeholder="Search pixel assets..." /><div>{visibleSprites.map((asset) => <button key={asset.id} className={block.spriteId === asset.id ? 'active' : ''} onClick={() => patch({ spriteId: asset.id })}><span>{asset.name}</span><small>{asset.id} / {asset.width}x{asset.height} / {asset.frames?.length ?? 1}f</small></button>)}</div></div>
      <div className="resource-drops-head"><div><span>DESTROYED DROPS</span><b>{block.drops.length} RULES</b></div><button onClick={() => patch({ drops: [...block.drops, { itemId: 'scrap', min: 1, max: 1, chance: 1, when: 'depleted' }] })}>+ ADD DROP</button></div><div className="resource-drops">{block.drops.map((drop, index) => <div key={index}><label>ITEM<select value={drop.itemId} onChange={(event) => patchDrop(index, { itemId: event.target.value })}>{Object.entries(ITEMS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label><label>MIN<input type="number" value={drop.min} onChange={(event) => patchDrop(index, { min: Number(event.target.value) })} /></label><label>MAX<input type="number" value={drop.max} onChange={(event) => patchDrop(index, { max: Number(event.target.value) })} /></label><label>CHANCE %<input type="number" min={0} max={100} value={Math.round(drop.chance * 100)} onChange={(event) => patchDrop(index, { chance: Number(event.target.value) / 100 })} /></label><button onClick={() => patch({ drops: block.drops.filter((_, at) => at !== index) })}>REMOVE</button></div>)}</div>
      <div className="engine-actions"><span>{status}</span><button onClick={() => void save(false)}>SAVE DRAFT</button><button className="publish" onClick={() => void save(true)}>PUBLISH LIVE</button></div></div> : <div className="engine-empty">Create a block definition.</div>}
    </div></section>;
}
