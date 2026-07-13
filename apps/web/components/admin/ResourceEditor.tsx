'use client';

import { useEffect, useState } from 'react';
import { ITEMS, Tile, type ResourceNodeDef, type SoundDocument, type SpriteDocument } from '@holdout/shared';

const NEW_RESOURCE: ResourceNodeDef = {
  id: 'new_tree', name: 'New tree', tile: Tile.Tree, depletedTile: Tile.Stump,
  maxHits: 8, respawnMs: 240_000, skill: 'woodcutting', spriteId: 'resource:ironwood',
  hitSound: 'chop', breakSound: 'tree_fall', drops: [{ itemId: 'wood', min: 2, max: 4, chance: 1, when: 'hit' }],
};

export function ResourceEditor() {
  const [resources, setResources] = useState<Record<string, ResourceNodeDef>>({});
  const [sprites, setSprites] = useState<SpriteDocument>({ palette: [], assets: [] });
  const [sounds, setSounds] = useState<SoundDocument>({ presets: {}, actions: {} });
  const [selected, setSelected] = useState('');
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading resource definitions...');
  const resource = resources[selected];

  useEffect(() => {
    void Promise.all(['resources', 'sprites', 'sounds'].map((kind) => fetch(`/api/admin/content/${kind}`, { cache: 'no-store' }).then((response) => response.json())))
      .then(([resourceData, spriteData, soundData]) => {
        const records = resourceData.draft ?? {};
        setResources(records); setSprites(spriteData.draft ?? { palette: [], assets: [] }); setSounds(soundData.draft ?? { presets: {}, actions: {} });
        setSelected(Object.keys(records)[0] ?? '');
        setMeta({ revision: resourceData.revision, publishedRevision: resourceData.publishedRevision });
        setStatus('Resource draft loaded');
      }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  const patch = (value: Partial<ResourceNodeDef>) => {
    if (!resource) return;
    setResources((current) => ({ ...current, [selected]: { ...current[selected], ...value, id: selected } }));
  };

  const add = () => {
    const id = window.prompt('Resource id', 'new_tree')?.trim().replace(/[^a-z0-9_-]/gi, '_');
    if (!id || resources[id]) return;
    setResources((current) => ({ ...current, [id]: { ...NEW_RESOURCE, id, name: id.replaceAll('_', ' ') } }));
    setSelected(id);
  };

  const remove = () => {
    if (!resource || !window.confirm(`Delete ${resource.name}? Existing map nodes using it will fail validation.`)) return;
    const next = { ...resources }; delete next[selected]; setResources(next); setSelected(Object.keys(next)[0] ?? '');
  };

  const patchDrop = (index: number, value: Partial<ResourceNodeDef['drops'][number]>) => patch({ drops: resource.drops.map((drop, at) => at === index ? { ...drop, ...value } : drop) });
  const addDrop = () => patch({ drops: [...resource.drops, { itemId: 'wood', min: 1, max: 1, chance: 1, when: 'depleted' }] });

  const save = async (publish: boolean) => {
    setStatus('Validating resources and drop rules...');
    const response = await fetch('/api/admin/content/resources', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: resources }) });
    const data = await response.json();
    if (!response.ok) { setStatus(data.error ?? 'Resource save failed'); return; }
    setMeta((current) => ({ ...current, revision: data.revision }));
    if (!publish) { setStatus(`Resource draft r${data.revision} saved`); return; }
    const published = await fetch('/api/admin/content/resources', { method: 'POST' });
    const publishedData = await published.json();
    if (published.ok) setMeta({ revision: data.revision, publishedRevision: publishedData.publishedRevision });
    setStatus(published.ok ? `Resource revision ${publishedData.publishedRevision} is live` : publishedData.error);
  };

  return <section className="engine-editor">
    <header className="engine-editor-head"><div><div className="engine-kicker">WORLD RESOURCE SYSTEM</div><h1>Resource nodes</h1><p>Create tree, rock and ore variants with authoritative durability, respawn, art, sounds and weighted drops. Paint published variants from the map Nodes tab.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="resource-workbench">
      <aside className="engine-records"><div className="engine-record-toolbar"><b>{Object.keys(resources).length} NODES</b><button onClick={add}>+ NEW</button></div>{Object.entries(resources).map(([id, entry]) => <button key={id} className={selected === id ? 'active' : ''} onClick={() => setSelected(id)}><span>{entry.name}</span><small>{entry.skill} / {entry.maxHits} hits</small></button>)}</aside>
      {resource ? <div className="resource-form"><div className="mob-form-head"><div><span>RESOURCE ID</span><b>{selected}</b></div><button onClick={remove}>DELETE</button></div>
        <div className="resource-form-grid">
          <label>DISPLAY NAME<input value={resource.name} onChange={(event) => patch({ name: event.target.value })} /></label>
          <label>NODE TYPE<select value={resource.tile} onChange={(event) => { const tile = Number(event.target.value); patch({ tile, depletedTile: tile === Tile.Tree ? Tile.Stump : Tile.Rubble, skill: tile === Tile.Tree ? 'woodcutting' : 'mining' }); }}><option value={Tile.Tree}>TREE</option><option value={Tile.Rock}>ROCK</option><option value={Tile.CopperOre}>COPPER VEIN</option><option value={Tile.IronOre}>IRON VEIN</option></select></label>
          <label>HITS TO DEPLETE<input type="number" min={1} max={100000} value={resource.maxHits} onChange={(event) => patch({ maxHits: Number(event.target.value) })} /></label>
          <label>RESPAWN SECONDS<input type="number" min={1} max={86400} value={resource.respawnMs / 1000} onChange={(event) => patch({ respawnMs: Number(event.target.value) * 1000 })} /></label>
          <label>SPRITE ASSET<select value={resource.spriteId ?? ''} onChange={(event) => patch({ spriteId: event.target.value })}><option value="">Built-in tile sprite</option>{sprites.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} / {asset.id}</option>)}</select></label>
          <label>HIT SOUND<select value={resource.hitSound ?? ''} onChange={(event) => patch({ hitSound: event.target.value })}><option value="">Default</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name}</option>)}</select></label>
          <label>BREAK SOUND<select value={resource.breakSound ?? ''} onChange={(event) => patch({ breakSound: event.target.value })}><option value="">Default</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name}</option>)}</select></label>
        </div>
        <div className="resource-drops-head"><div><span>DROP PROGRAM</span><b>{resource.drops.length} RULES</b></div><button onClick={addDrop}>+ ADD DROP</button></div>
        <div className="resource-drops">{resource.drops.map((drop, index) => <div key={index}><label>ITEM<select value={drop.itemId} onChange={(event) => patchDrop(index, { itemId: event.target.value })}>{Object.entries(ITEMS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label><label>WHEN<select value={drop.when} onChange={(event) => patchDrop(index, { when: event.target.value as 'hit' | 'depleted' })}><option value="hit">EVERY HIT</option><option value="depleted">ON DEPLETION</option></select></label><label>MIN<input type="number" min={1} value={drop.min} onChange={(event) => patchDrop(index, { min: Number(event.target.value) })} /></label><label>MAX<input type="number" min={drop.min} value={drop.max} onChange={(event) => patchDrop(index, { max: Number(event.target.value) })} /></label><label>CHANCE %<input type="number" min={0} max={100} value={Math.round(drop.chance * 100)} onChange={(event) => patchDrop(index, { chance: Number(event.target.value) / 100 })} /></label><button onClick={() => patch({ drops: resource.drops.filter((_, at) => at !== index) })}>REMOVE</button></div>)}</div>
        <div className="engine-actions"><span>{status}</span><button onClick={() => void save(false)}>SAVE DRAFT</button><button className="publish" onClick={() => void save(true)}>PUBLISH LIVE</button></div>
      </div> : <div className="engine-empty">Create a resource definition.</div>}
    </div>
  </section>;
}
