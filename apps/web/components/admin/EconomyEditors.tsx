'use client';

import { useEffect, useState } from 'react';
import { ITEMS, type ItemId, type Recipe, type RecipeCat, type StationKind, type TradeEntry } from '@holdout/shared';
import { persistContentDraft, type EditorMeta } from './content-editor-api';

const ITEM_OPTIONS = Object.entries(ITEMS).sort(([, a], [, b]) => a.name.localeCompare(b.name));
const CATEGORIES: RecipeCat[] = ['survival', 'medical', 'gear', 'build', 'smelt', 'forge'];
const STATIONS: { value: '' | StationKind; label: string }[] = [
  { value: '', label: 'Hand craft (no station)' },
  { value: 'workbench', label: 'Workbench' },
  { value: 'furnace', label: 'Furnace' },
  { value: 'anvil', label: 'Anvil' },
];

interface TraderDef { id: string; name: string; questTier: number; stock: TradeEntry[] }

function ItemSelect({ value, onChange }: { value: ItemId; onChange: (value: ItemId) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value as ItemId)}>{ITEM_OPTIONS.map(([id, item]) => <option key={id} value={id}>{item.name} ({id})</option>)}</select>;
}

export function RecipeEditor() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [meta, setMeta] = useState<EditorMeta>({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading recipes...');
  const recipe = recipes.find((entry) => entry.id === selected);

  useEffect(() => { void fetch('/api/admin/content/recipes', { cache: 'no-store' }).then((response) => response.json()).then((data) => {
    const next = Array.isArray(data.draft) ? data.draft as Recipe[] : [];
    setRecipes(next); setSelected(next[0]?.id ?? ''); setMeta({ revision: data.revision, publishedRevision: data.publishedRevision }); setStatus('Recipe draft loaded');
  }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`)); }, []);

  const patch = (value: Partial<Recipe>) => setRecipes((current) => current.map((entry) => entry.id === selected ? { ...entry, ...value } : entry));
  const add = () => {
    let number = recipes.length + 1; let id = `craft_new_${number}`;
    while (recipes.some((entry) => entry.id === id)) id = `craft_new_${++number}`;
    const next: Recipe = { id, cat: 'survival', out: { id: 'wood', qty: 1 }, cost: [{ id: 'stone', qty: 1 }] };
    setRecipes((current) => [...current, next]); setSelected(id);
  };
  const remove = () => { if (!recipe || !window.confirm(`Delete ${recipe.id}?`)) return; const next = recipes.filter((entry) => entry.id !== recipe.id); setRecipes(next); setSelected(next[0]?.id ?? ''); };
  const patchCost = (index: number, value: Partial<Recipe['cost'][number]>) => patch({ cost: recipe!.cost.map((entry, at) => at === index ? { ...entry, ...value } : entry) });
  const filter = search.toLowerCase();

  return <section className="engine-editor"><header className="engine-editor-head"><div><div className="engine-kicker">VISUAL ECONOMY AUTHORING</div><h1>Crafting recipes</h1><p>Build recipes with item selectors, quantities, categories and station restrictions. Published recipes are validated and used by the authoritative game server.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="economy-workbench"><aside className="engine-records"><div className="engine-record-toolbar"><b>{recipes.length} RECIPES</b><button onClick={add}>+ NEW</button></div><input className="engine-list-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipes..." />{recipes.filter((entry) => `${entry.id} ${ITEMS[entry.out.id]?.name ?? ''}`.toLowerCase().includes(filter)).map((entry) => <button key={entry.id} className={selected === entry.id ? 'active' : ''} onClick={() => setSelected(entry.id)}><span>{ITEMS[entry.out.id]?.name ?? entry.out.id} x{entry.out.qty}</span><small>{entry.id} / {entry.station ?? 'hand'}</small></button>)}</aside>
      {recipe ? <div className="economy-form"><div className="mob-form-head"><div><span>RECIPE ID</span><b>{recipe.id}</b></div><button onClick={remove}>DELETE</button></div><div className="economy-form-grid"><label>OUTPUT ITEM<ItemSelect value={recipe.out.id} onChange={(id) => patch({ out: { ...recipe.out, id } })} /></label><label>OUTPUT QUANTITY<input type="number" min={1} value={recipe.out.qty} onChange={(event) => patch({ out: { ...recipe.out, qty: Number(event.target.value) } })} /></label><label>CATEGORY<select value={recipe.cat} onChange={(event) => patch({ cat: event.target.value as RecipeCat })}>{CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}</select></label><label>REQUIRED STATION<select value={recipe.station ?? ''} onChange={(event) => patch(event.target.value ? { station: event.target.value as StationKind } : { station: undefined })}>{STATIONS.map((station) => <option key={station.value} value={station.value}>{station.label}</option>)}</select></label></div>
      <div className="resource-drops-head"><div><span>INGREDIENT COST</span><b>{recipe.cost.length} ITEMS</b></div><button onClick={() => patch({ cost: [...recipe.cost, { id: 'wood', qty: 1 }] })}>+ ADD INGREDIENT</button></div><div className="economy-rows">{recipe.cost.map((cost, index) => <div key={index}><label>ITEM<ItemSelect value={cost.id} onChange={(id) => patchCost(index, { id })} /></label><label>QUANTITY<input type="number" min={1} value={cost.qty} onChange={(event) => patchCost(index, { qty: Number(event.target.value) })} /></label><button onClick={() => patch({ cost: recipe.cost.filter((_, at) => at !== index) })}>REMOVE</button></div>)}</div>
      <div className="engine-actions"><span>{status}</span><button onClick={() => void persistContentDraft('recipes', recipes, false, setStatus, setMeta)}>SAVE DRAFT</button><button className="publish" onClick={() => void persistContentDraft('recipes', recipes, true, setStatus, setMeta)}>PUBLISH LIVE</button></div></div> : <div className="engine-empty">Create a recipe to begin.</div>}</div></section>;
}

export function TraderEditor() {
  const [traders, setTraders] = useState<Record<string, TraderDef>>({});
  const [selected, setSelected] = useState('');
  const [meta, setMeta] = useState<EditorMeta>({ revision: 0, publishedRevision: 0 });
  const [status, setStatus] = useState('Loading traders...');
  const trader = traders[selected];

  useEffect(() => { void fetch('/api/admin/content/traders', { cache: 'no-store' }).then((response) => response.json()).then((data) => {
    const next = data.draft && typeof data.draft === 'object' ? data.draft as Record<string, TraderDef> : {};
    setTraders(next); setSelected(Object.keys(next)[0] ?? ''); setMeta({ revision: data.revision, publishedRevision: data.publishedRevision }); setStatus('Trader draft loaded');
  }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`)); }, []);

  const patch = (value: Partial<TraderDef>) => setTraders((current) => ({ ...current, [selected]: { ...current[selected], ...value, id: selected } }));
  const add = () => { let number = Object.keys(traders).length + 1; let id = `trader_${number}`; while (traders[id]) id = `trader_${++number}`; setTraders((current) => ({ ...current, [id]: { id, name: 'New trader', questTier: 1, stock: [] } })); setSelected(id); };
  const remove = () => { if (!trader || !window.confirm(`Delete ${trader.name}?`)) return; const next = { ...traders }; delete next[selected]; setTraders(next); setSelected(Object.keys(next)[0] ?? ''); };
  const patchStock = (index: number, value: Partial<TradeEntry>) => patch({ stock: trader.stock.map((entry, at) => at === index ? { ...entry, ...value } : entry) });

  return <section className="engine-editor"><header className="engine-editor-head"><div><div className="engine-kicker">VISUAL ECONOMY AUTHORING</div><h1>Trader inventories</h1><p>Control what each trader buys and sells, pricing in both directions, and the quest tier attached to that trader.</p></div><div className="engine-revisions"><span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span><small>draft r{meta.revision} / live r{meta.publishedRevision}</small></div></header>
    <div className="economy-workbench"><aside className="engine-records"><div className="engine-record-toolbar"><b>{Object.keys(traders).length} TRADERS</b><button onClick={add}>+ NEW</button></div>{Object.entries(traders).map(([id, entry]) => <button key={id} className={selected === id ? 'active' : ''} onClick={() => setSelected(id)}><span>{entry.name}</span><small>{entry.stock.length} listings / tier {entry.questTier}</small></button>)}</aside>
      {trader ? <div className="economy-form"><div className="mob-form-head"><div><span>TRADER ID</span><b>{selected}</b></div><button onClick={remove}>DELETE</button></div><div className="economy-form-grid"><label>DISPLAY NAME<input value={trader.name} onChange={(event) => patch({ name: event.target.value })} /></label><label>QUEST TIER<input type="number" min={1} max={100} value={trader.questTier} onChange={(event) => patch({ questTier: Number(event.target.value) })} /></label></div>
      <div className="resource-drops-head"><div><span>BUY / SELL INVENTORY</span><b>{trader.stock.length} LISTINGS</b></div><button onClick={() => patch({ stock: [...trader.stock, { id: 'wood', buy: 5, sell: 2 }] })}>+ ADD LISTING</button></div><div className="economy-rows trader-rows">{trader.stock.map((entry, index) => <div key={index}><label>ITEM<ItemSelect value={entry.id} onChange={(id) => patchStock(index, { id })} /></label><label>TRADER SELLS FOR<input type="number" min={0} value={entry.buy} onChange={(event) => patchStock(index, { buy: Number(event.target.value) })} /></label><label>TRADER BUYS FOR<input type="number" min={0} value={entry.sell} onChange={(event) => patchStock(index, { sell: Number(event.target.value) })} /></label><button onClick={() => patch({ stock: trader.stock.filter((_, at) => at !== index) })}>REMOVE</button></div>)}</div>
      <div className="engine-actions"><span>{status}</span><button onClick={() => void persistContentDraft('traders', traders, false, setStatus, setMeta)}>SAVE DRAFT</button><button className="publish" onClick={() => void persistContentDraft('traders', traders, true, setStatus, setMeta)}>PUBLISH LIVE</button></div></div> : <div className="engine-empty">Create a trader to begin.</div>}</div></section>;
}
