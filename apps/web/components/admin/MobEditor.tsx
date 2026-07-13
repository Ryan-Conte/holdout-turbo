'use client';

import { useEffect, useState } from 'react';
import type { EngineMobDefinition, LootTableRegistry, SoundDocument, SpriteDocument } from '@holdout/shared';

const NEW_MOB: EngineMobDefinition = {
  id: 'new_mob', name: 'New mob', behavior: 'melee', maxHp: 50, speed: 100,
  aggroRange: 200, attackRange: 28, damage: 10, attackMs: 900,
  boss: false, lootTable: 'zombie', spriteId: 'character:zombie', respawnMs: 90_000,
};

export function MobEditor() {
  const [mobs, setMobs] = useState<Record<string, EngineMobDefinition>>({});
  const [loot, setLoot] = useState<LootTableRegistry>({});
  const [sprites, setSprites] = useState<SpriteDocument>({ palette: [], assets: [] });
  const [sounds, setSounds] = useState<SoundDocument>({ presets: {}, actions: {} });
  const [selected, setSelected] = useState('');
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading mobs...');
  const mob = mobs[selected];

  useEffect(() => {
    void Promise.all(['mobs', 'loot', 'sprites', 'sounds'].map((kind) => fetch(`/api/admin/content/${kind}`, { cache: 'no-store' }).then((res) => res.json())))
      .then(([mobData, lootData, spriteData, soundData]) => {
        const records = mobData.draft as Record<string, EngineMobDefinition>;
        setMobs(records); setLoot(lootData.draft ?? {}); setSprites(spriteData.draft ?? { palette: [], assets: [] }); setSounds(soundData.draft ?? { presets: {}, actions: {} });
        setSelected(Object.keys(records)[0] ?? '');
        setMeta({ revision: mobData.revision, publishedRevision: mobData.publishedRevision });
        setStatus('Mob draft loaded');
      }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  const patch = (next: Partial<EngineMobDefinition>) => {
    if (!mob) return;
    setMobs((current) => ({ ...current, [selected]: { ...current[selected], ...next, id: selected } }));
  };

  const number = (key: keyof EngineMobDefinition, min: number, max: number, scale = 1) => (
    <input type="number" min={min} max={max} value={Number(mob?.[key] ?? 0) / scale} onChange={(event) => patch({ [key]: Math.max(min, Math.min(max, Number(event.target.value))) * scale } as Partial<EngineMobDefinition>)} />
  );

  const soundSelect = (action: 'idle' | 'alert' | 'attack' | 'hit' | 'death') => <label>{action.toUpperCase()} SOUND<select value={mob?.sounds?.[action] ?? ''} onChange={(event) => patch({ sounds: { ...(mob.sounds ?? {}), [action]: event.target.value || undefined } })}><option value="">No assigned sound</option>{Object.entries(sounds.presets).map(([id, sound]) => <option key={id} value={id}>{sound.name} / {id}</option>)}</select></label>;

  const add = () => {
    const requested = window.prompt('New mob id', 'new_mob')?.trim().replace(/[^a-z0-9_-]/gi, '_');
    if (!requested || mobs[requested]) return;
    setMobs((current) => ({ ...current, [requested]: { ...NEW_MOB, id: requested, name: requested.replaceAll('_', ' ') } }));
    setSelected(requested);
  };

  const remove = () => {
    if (!mob || !window.confirm(`Delete ${mob.name}? Existing map placements will become invalid.`)) return;
    const next = { ...mobs }; delete next[selected];
    setMobs(next); setSelected(Object.keys(next)[0] ?? '');
  };

  const save = async (publish: boolean) => {
    setStatus('Validating mob definitions...');
    const saved = await fetch('/api/admin/content/mobs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: mobs }) });
    const data = await saved.json();
    if (!saved.ok) { setStatus(data.error ?? 'Mob save failed'); return; }
    setMeta((current) => ({ ...current, revision: data.revision }));
    if (!publish) { setStatus(`Mob draft revision ${data.revision} saved`); return; }
    const published = await fetch('/api/admin/content/mobs', { method: 'POST' });
    const publishedData = await published.json();
    if (published.ok) setMeta((current) => ({ ...current, publishedRevision: publishedData.publishedRevision }));
    setStatus(published.ok ? `Mob revision ${publishedData.publishedRevision} published` : publishedData.error);
  };

  return <section className="engine-editor">
    <header className="engine-editor-head"><div><div className="engine-kicker">ENTITY WORKBENCH</div><h1>Mobs and bosses</h1><p>Create authoritative enemies and wildlife. Combat attributes apply on game servers after publish; artwork and state clips are linked through the animation studio.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="mob-workbench">
      <aside className="engine-records"><div className="engine-record-toolbar"><b>{Object.keys(mobs).length} MOBS</b><button onClick={add}>+ NEW</button></div>{Object.entries(mobs).map(([id, entry]) => <button className={selected === id ? 'active' : ''} key={id} onClick={() => setSelected(id)}><span>{entry.boss ? `[BOSS] ${entry.name}` : entry.name}</span><small>{id}</small></button>)}</aside>
      {mob ? <div className="mob-form">
        <div className="mob-form-head"><div><span>ENTITY ID</span><b>{selected}</b></div><button onClick={remove}>DELETE</button></div>
        <div className="mob-form-grid">
          <label>DISPLAY NAME<input value={mob.name} onChange={(event) => patch({ name: event.target.value })} /></label>
          <label>AI BEHAVIOR<select value={mob.behavior} onChange={(event) => patch({ behavior: event.target.value as EngineMobDefinition['behavior'] })}><option value="melee">MELEE HUNTER</option><option value="ranged">RANGED</option><option value="flee">FLEE / WILDLIFE</option></select></label>
          <label>MAX HEALTH{number('maxHp', 1, 1_000_000)}</label>
          <label>MOVE SPEED{number('speed', 0, 1000)}</label>
          <label>AGGRO / FLEE RANGE{number('aggroRange', 0, 5000)}</label>
          <label>ATTACK RANGE{number('attackRange', 0, 5000)}</label>
          <label>ATTACK DAMAGE{number('damage', 0, 100_000)}</label>
          <label>ATTACK COOLDOWN (MS){number('attackMs', 50, 600_000)}</label>
          <label>RESPAWN (SECONDS){number('respawnMs', 1, 86_400, 1000)}</label>
          <label>DROP TABLE<select value={mob.lootTable} onChange={(event) => patch({ lootTable: event.target.value })}>{Object.entries(loot).map(([id, table]) => <option key={id} value={id}>{table.name ?? id}</option>)}</select></label>
          <label>SPRITE ASSET<select value={mob.spriteId} onChange={(event) => patch({ spriteId: event.target.value })}>{!sprites.assets.some((asset) => asset.id === mob.spriteId) && <option value={mob.spriteId}>{mob.spriteId} (sheet fallback)</option>}{sprites.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.frames?.length ?? 1}f)</option>)}</select></label>
          <label className="mob-boss-toggle"><input type="checkbox" checked={mob.boss} onChange={(event) => patch({ boss: event.target.checked })} /> BOSS ENTITY</label>
          {soundSelect('alert')}{soundSelect('attack')}{soundSelect('hit')}{soundSelect('death')}
        </div>
        <div className="mob-animation-link"><b>ANIMATION TARGET</b><code>mob:{selected}</code><span>Configure idle, walk, attack, hit and death clips in the Animations tab.</span></div>
        <div className="engine-actions"><span>{status}</span><button onClick={() => void save(false)}>SAVE DRAFT</button><button className="publish" onClick={() => void save(true)}>PUBLISH LIVE</button></div>
      </div> : <div className="engine-empty">Create a mob record.</div>}
    </div>
  </section>;
}
