'use client';

import { useEffect, useState } from 'react';
import { type BuildType, type ItemKind, type SpriteDocument } from '@holdout/shared';
import { loadContentDraft, persistContentDraft, type EditorMeta } from './content-editor-api';

interface EngineWeaponStats {
  damage: number;
  fireRateMs: number;
  ammo: string;
  pellets: number;
  spread: number;
  bulletSpeed: number;
  range: number;
  magSize: number;
  reloadMs: number;
  noise?: number;
}

interface EngineMeleeStats {
  damage: number;
  cooldownMs: number;
  range: number;
  wood: number;
  stone: number;
}

interface EngineItem {
  id: string;
  name: string;
  kind: ItemKind;
  kg: number;
  stack: number;
  desc: string;
  spriteId?: string;
  durability?: number;
  lightRadius?: number;
  weapon?: EngineWeaponStats;
  melee?: EngineMeleeStats;
  armor?: { piece: 'helmet' | 'vest'; reduction: number };
  heal?: number;
  food?: number;
  drink?: number;
  raw?: string;
  emptyTo?: string;
  fillFrom?: string;
  backpackTier?: number;
  place?: BuildType;
}

const ITEM_KINDS: ItemKind[] = ['weapon', 'tool', 'ammo', 'material', 'consumable', 'backpack', 'armor', 'mod', 'placeable'];
const BUILD_TYPES: BuildType[] = ['chest', 'workbench', 'firepit', 'furnace', 'anvil', 'bed', 'wood_floor', 'stone_floor', 'wall', 'door', 'fence', 'torch'];
const EMPTY_META: EditorMeta = { revision: 0, publishedRevision: 0 };

function numericValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function defaultItem(id: string, kind: ItemKind = 'material'): EngineItem {
  return { id, name: 'New item', kind, kg: 0.1, stack: 1, desc: 'Describe this item.', spriteId: `item:${id}` };
}

function withKind(item: EngineItem, kind: ItemKind): EngineItem {
  const next = defaultItem(item.id, kind);
  Object.assign(next, {
    name: item.name,
    kg: item.kg,
    stack: item.stack,
    desc: item.desc,
    spriteId: item.spriteId,
    durability: item.durability,
    lightRadius: item.lightRadius,
  });
  if (kind === 'weapon') next.weapon = { damage: 10, fireRateMs: 400, ammo: 'ammo_9mm', pellets: 1, spread: 0.05, bulletSpeed: 700, range: 500, magSize: 10, reloadMs: 1500 };
  if (kind === 'tool') next.melee = { damage: 10, cooldownMs: 600, range: 38, wood: 1, stone: 1 };
  if (kind === 'armor') next.armor = { piece: 'vest', reduction: 0.1 };
  if (kind === 'backpack') next.backpackTier = 1;
  if (kind === 'placeable') next.place = 'wall';
  return next;
}

export function ItemEditor() {
  const [items, setItems] = useState<Record<string, EngineItem>>({});
  const [sprites, setSprites] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | ItemKind>('all');
  const [meta, setMeta] = useState<EditorMeta>(EMPTY_META);
  const [status, setStatus] = useState('Loading items...');
  const item = items[selected];

  useEffect(() => {
    void Promise.all([
      loadContentDraft<Record<string, EngineItem>>('items'),
      loadContentDraft<SpriteDocument>('sprites'),
    ]).then(([itemData, spriteData]) => {
      const records = itemData.draft && typeof itemData.draft === 'object' ? itemData.draft : {};
      setItems(records);
      setSelected(Object.keys(records)[0] ?? '');
      setMeta(itemData.meta);
      setSprites((spriteData.draft.assets ?? []).map((asset) => asset.id).filter((id) => id.startsWith('item:')).sort());
      setStatus('Item draft loaded');
    }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  const patch = (value: Partial<EngineItem>) => {
    if (!selected) return;
    setItems((current) => ({ ...current, [selected]: { ...current[selected], ...value, id: selected } }));
  };
  const patchWeapon = (value: Partial<EngineWeaponStats>) => patch({ weapon: { ...item.weapon!, ...value } });
  const patchMelee = (value: Partial<EngineMeleeStats>) => patch({ melee: { ...item.melee!, ...value } });

  const add = () => {
    const requested = window.prompt('New item ID', `item_${Object.keys(items).length + 1}`);
    const id = requested?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!id || items[id]) {
      if (id) setStatus(`Item ${id} already exists`);
      return;
    }
    const next = defaultItem(id);
    setItems((current) => ({ ...current, [id]: next }));
    setSelected(id);
  };

  const duplicate = () => {
    if (!item) return;
    let number = 2;
    let id = `${selected}_copy`;
    while (items[id]) id = `${selected}_copy_${number++}`;
    setItems((current) => ({ ...current, [id]: { ...item, id, name: `${item.name} Copy`, spriteId: item.spriteId } }));
    setSelected(id);
  };

  const remove = () => {
    if (!item || !window.confirm(`Delete ${item.name}? Loot, recipes and traders may still reference ${selected}.`)) return;
    const next = { ...items };
    delete next[selected];
    setItems(next);
    setSelected(Object.keys(next)[0] ?? '');
  };

  const itemOptions = Object.values(items).sort((a, b) => a.name.localeCompare(b.name));
  const visibleItems = itemOptions.filter((entry) => {
    const matchesKind = kindFilter === 'all' || entry.kind === kindFilter;
    const needle = search.trim().toLowerCase();
    return matchesKind && (!needle || `${entry.id} ${entry.name} ${entry.kind}`.toLowerCase().includes(needle));
  });
  const relationOptions = (value?: string) => (
    <>
      <option value="">None</option>
      {value && !items[value] && <option value={value}>{value} (missing)</option>}
      {itemOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}
    </>
  );

  return (
    <section className="engine-editor item-editor">
      <header className="engine-editor-head">
        <div>
          <div className="engine-kicker">VISUAL ITEM AUTHORING</div>
          <h1>Items</h1>
          <p>Edit item identity, inventory rules, combat behavior, survival effects, placement, durability, and sprite mapping without touching JSON.</p>
        </div>
        <div className="engine-revisions">
          <span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span>
          <small>draft r{meta.revision} / live r{meta.publishedRevision}</small>
        </div>
      </header>

      <div className="item-workbench">
        <aside className="engine-records">
          <div className="engine-record-toolbar"><b>{Object.keys(items).length} ITEMS</b><button onClick={add}>+ NEW</button></div>
          <div className="item-list-filters">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items..." />
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | ItemKind)}>
              <option value="all">All categories</option>
              {ITEM_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </div>
          {visibleItems.map((entry) => (
            <button key={entry.id} className={selected === entry.id ? 'active' : ''} onClick={() => setSelected(entry.id)}>
              <span>{entry.name}</span><small>{entry.kind} / {entry.id}</small>
            </button>
          ))}
        </aside>

        {item ? (
          <div className="item-form">
            <div className="mob-form-head">
              <div><span>ITEM ID</span><b>{selected}</b></div>
              <div className="item-head-actions"><button onClick={duplicate}>DUPLICATE</button><button onClick={remove}>DELETE</button></div>
            </div>

            <div className="item-form-grid">
              <label>DISPLAY NAME<input value={item.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label>CATEGORY<select value={item.kind} onChange={(event) => setItems((current) => ({ ...current, [selected]: withKind(item, event.target.value as ItemKind) }))}>{ITEM_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
              <label>WEIGHT (KG)<input type="number" min={0} step={0.01} value={item.kg} onChange={(event) => patch({ kg: numericValue(event.target.value, 0) })} /></label>
              <label>MAX STACK<input type="number" min={1} value={item.stack} onChange={(event) => patch({ stack: numericValue(event.target.value, 1) })} /></label>
              <label>MAX DURABILITY<input type="number" min={1} value={item.durability ?? ''} placeholder="Not wearable" onChange={(event) => patch({ durability: optionalNumber(event.target.value) })} /></label>
              <label>LIGHT RADIUS<input type="number" min={0} max={2000} value={item.lightRadius ?? ''} placeholder="No light" onChange={(event) => patch({ lightRadius: optionalNumber(event.target.value) })} /></label>
              <label>SPRITE ASSET<select value={item.spriteId ?? `item:${selected}`} onChange={(event) => patch({ spriteId: event.target.value })}>
                {!sprites.includes(item.spriteId ?? `item:${selected}`) && <option value={item.spriteId ?? `item:${selected}`}>{item.spriteId ?? `item:${selected}`} (unpublished)</option>}
                {sprites.map((sprite) => <option key={sprite}>{sprite}</option>)}
              </select></label>
              <label className="item-description">DESCRIPTION<textarea value={item.desc} onChange={(event) => patch({ desc: event.target.value })} /></label>
            </div>

            {item.kind === 'weapon' && item.weapon && (
              <div className="item-behavior-section">
                <div className="item-section-title"><span>RANGED WEAPON</span><b>Ballistics and magazine</b></div>
                <div className="item-form-grid compact">
                  <label>DAMAGE<input type="number" min={0} value={item.weapon.damage} onChange={(event) => patchWeapon({ damage: numericValue(event.target.value, 0) })} /></label>
                  <label>FIRE DELAY (MS)<input type="number" min={1} value={item.weapon.fireRateMs} onChange={(event) => patchWeapon({ fireRateMs: numericValue(event.target.value, 1) })} /></label>
                  <label>AMMUNITION<select value={item.weapon.ammo} onChange={(event) => patchWeapon({ ammo: event.target.value })}>{relationOptions(item.weapon.ammo)}</select></label>
                  <label>PELLETS<input type="number" min={1} value={item.weapon.pellets} onChange={(event) => patchWeapon({ pellets: numericValue(event.target.value, 1) })} /></label>
                  <label>SPREAD (RADIANS)<input type="number" min={0} step={0.005} value={item.weapon.spread} onChange={(event) => patchWeapon({ spread: numericValue(event.target.value, 0) })} /></label>
                  <label>BULLET SPEED<input type="number" min={1} value={item.weapon.bulletSpeed} onChange={(event) => patchWeapon({ bulletSpeed: numericValue(event.target.value, 1) })} /></label>
                  <label>RANGE<input type="number" min={1} value={item.weapon.range} onChange={(event) => patchWeapon({ range: numericValue(event.target.value, 1) })} /></label>
                  <label>MAGAZINE SIZE<input type="number" min={1} value={item.weapon.magSize} onChange={(event) => patchWeapon({ magSize: numericValue(event.target.value, 1) })} /></label>
                  <label>RELOAD (MS)<input type="number" min={1} value={item.weapon.reloadMs} onChange={(event) => patchWeapon({ reloadMs: numericValue(event.target.value, 1) })} /></label>
                  <label>NOISE RADIUS<input type="number" min={0} value={item.weapon.noise ?? ''} placeholder="Default" onChange={(event) => patchWeapon({ noise: optionalNumber(event.target.value) })} /></label>
                </div>
              </div>
            )}

            {item.kind === 'tool' && item.melee && (
              <div className="item-behavior-section">
                <div className="item-section-title"><span>MELEE / TOOL</span><b>Combat and harvesting</b></div>
                <div className="item-form-grid compact">
                  <label>DAMAGE<input type="number" min={0} value={item.melee.damage} onChange={(event) => patchMelee({ damage: numericValue(event.target.value, 0) })} /></label>
                  <label>COOLDOWN (MS)<input type="number" min={1} value={item.melee.cooldownMs} onChange={(event) => patchMelee({ cooldownMs: numericValue(event.target.value, 1) })} /></label>
                  <label>REACH<input type="number" min={1} value={item.melee.range} onChange={(event) => patchMelee({ range: numericValue(event.target.value, 1) })} /></label>
                  <label>WOOD POWER<input type="number" min={0} value={item.melee.wood} onChange={(event) => patchMelee({ wood: numericValue(event.target.value, 0) })} /></label>
                  <label>STONE POWER<input type="number" min={0} value={item.melee.stone} onChange={(event) => patchMelee({ stone: numericValue(event.target.value, 0) })} /></label>
                </div>
              </div>
            )}

            {item.kind === 'armor' && item.armor && (
              <div className="item-behavior-section">
                <div className="item-section-title"><span>ARMOR</span><b>Equipment and mitigation</b></div>
                <div className="item-form-grid compact">
                  <label>EQUIPMENT SLOT<select value={item.armor.piece} onChange={(event) => patch({ armor: { ...item.armor!, piece: event.target.value as 'helmet' | 'vest' } })}><option value="helmet">Helmet</option><option value="vest">Vest</option></select></label>
                  <label>DAMAGE REDUCTION<input type="number" min={0} max={1} step={0.01} value={item.armor.reduction} onChange={(event) => patch({ armor: { ...item.armor!, reduction: numericValue(event.target.value, 0) } })} /></label>
                </div>
              </div>
            )}

            {item.kind === 'consumable' && (
              <div className="item-behavior-section">
                <div className="item-section-title"><span>CONSUMABLE</span><b>Leave unused effects blank</b></div>
                <div className="item-form-grid compact">
                  <label>HEALTH RESTORED<input type="number" min={0} value={item.heal ?? ''} onChange={(event) => patch({ heal: optionalNumber(event.target.value) })} /></label>
                  <label>HUNGER RESTORED<input type="number" min={0} value={item.food ?? ''} onChange={(event) => patch({ food: optionalNumber(event.target.value) })} /></label>
                  <label>THIRST RESTORED<input type="number" min={0} value={item.drink ?? ''} onChange={(event) => patch({ drink: optionalNumber(event.target.value) })} /></label>
                  <label>COOKED RESULT<select value={item.raw ?? ''} onChange={(event) => patch({ raw: event.target.value || undefined })}>{relationOptions(item.raw)}</select></label>
                  <label>EMPTY RESULT<select value={item.emptyTo ?? ''} onChange={(event) => patch({ emptyTo: event.target.value || undefined })}>{relationOptions(item.emptyTo)}</select></label>
                  <label>FILLED RESULT<select value={item.fillFrom ?? ''} onChange={(event) => patch({ fillFrom: event.target.value || undefined })}>{relationOptions(item.fillFrom)}</select></label>
                </div>
              </div>
            )}

            {item.kind === 'backpack' && <div className="item-behavior-section"><div className="item-section-title"><span>BACKPACK</span><b>Capacity tier</b></div><div className="item-form-grid compact"><label>BACKPACK TIER<input type="number" min={0} value={item.backpackTier ?? 1} onChange={(event) => patch({ backpackTier: numericValue(event.target.value, 1) })} /></label></div></div>}
            {item.kind === 'placeable' && <div className="item-behavior-section"><div className="item-section-title"><span>PLACEABLE KIT</span><b>World block mapping</b></div><div className="item-form-grid compact"><label>BUILDS BLOCK<select value={item.place ?? 'wall'} onChange={(event) => patch({ place: event.target.value as BuildType })}>{BUILD_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label></div></div>}

            <div className="item-runtime-note"><b>RUNTIME STATUS</b><span>Existing shared item IDs use these values today. New IDs and sprite remaps are stored and published for the ongoing DB-only item registry migration; loot tables can reference them immediately, but unsupported gameplay verbs remain inactive until the authoritative item registry migration lands.</span></div>
            <div className="engine-actions">
              <span>{status}</span>
              <button onClick={() => void persistContentDraft('items', items, false, setStatus, setMeta)}>SAVE DRAFT</button>
              <button className="publish" onClick={() => void persistContentDraft('items', items, true, setStatus, setMeta)}>PUBLISH LIVE</button>
            </div>
          </div>
        ) : <div className="engine-empty">Create an item to begin.</div>}
      </div>
    </section>
  );
}
