'use client';

import { useEffect, useState } from 'react';
import type { LootEntry, LootTableDef, LootTableRegistry } from '@holdout/shared';
import { loadContentDraft, persistContentDraft, type EditorMeta } from './content-editor-api';

interface ItemSummary { id: string; name: string; kind?: string }

const EMPTY_META: EditorMeta = { revision: 0, publishedRevision: 0 };

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function LootEditor() {
  const [tables, setTables] = useState<LootTableRegistry>({});
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [meta, setMeta] = useState<EditorMeta>(EMPTY_META);
  const [status, setStatus] = useState('Loading loot tables...');
  const table = tables[selected];

  useEffect(() => {
    void Promise.all([
      loadContentDraft<LootTableRegistry>('loot'),
      loadContentDraft<Record<string, { id?: string; name?: string; kind?: string }>>('items'),
    ]).then(([lootData, itemData]) => {
      const nextTables = lootData.draft && typeof lootData.draft === 'object' ? lootData.draft : {};
      setTables(nextTables);
      setSelected(Object.keys(nextTables)[0] ?? '');
      setMeta(lootData.meta);
      setItems(Object.entries(itemData.draft ?? {}).map(([id, item]) => ({ id, name: item.name ?? id, kind: item.kind })).sort((a, b) => a.name.localeCompare(b.name)));
      setStatus('Loot draft loaded');
    }).catch((error) => setStatus(`Load failed: ${(error as Error).message}`));
  }, []);

  const patch = (value: Partial<LootTableDef>) => {
    if (!selected) return;
    setTables((current) => ({ ...current, [selected]: { ...current[selected], ...value, id: selected } }));
  };
  const patchEntry = (index: number, value: Partial<LootEntry>) => patch({
    entries: table.entries.map((entry, at) => at === index ? { ...entry, ...value } : entry),
  });

  const add = () => {
    const requested = window.prompt('New loot table ID', `loot_${Object.keys(tables).length + 1}`);
    const id = requested?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!id || tables[id]) {
      if (id) setStatus(`Loot table ${id} already exists`);
      return;
    }
    const next: LootTableDef = { id, name: 'New loot table', minRolls: 1, maxRolls: 1, entries: [{ id: items[0]?.id ?? 'wood', weight: 1, min: 1, max: 1 }] };
    setTables((current) => ({ ...current, [id]: next }));
    setSelected(id);
  };

  const duplicate = () => {
    if (!table) return;
    let number = 2;
    let id = `${selected}_copy`;
    while (tables[id]) id = `${selected}_copy_${number++}`;
    setTables((current) => ({ ...current, [id]: { ...table, id, name: `${table.name} Copy`, entries: table.entries.map((entry) => ({ ...entry })) } }));
    setSelected(id);
  };

  const remove = () => {
    if (!table || !window.confirm(`Delete ${table.name}? Maps and mobs may still reference ${selected}.`)) return;
    const next = { ...tables };
    delete next[selected];
    setTables(next);
    setSelected(Object.keys(next)[0] ?? '');
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (!table || target < 0 || target >= table.entries.length) return;
    const entries = table.entries.slice();
    [entries[index], entries[target]] = [entries[target], entries[index]];
    patch({ entries });
  };

  const totalWeight = table?.entries.reduce((total, entry) => total + Math.max(0, Number(entry.weight) || 0), 0) ?? 0;
  const averageRolls = table ? (table.minRolls + table.maxRolls) / 2 : 0;
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? id;
  const itemOptions = (id: string) => (
    <>
      {!items.some((item) => item.id === id) && <option value={id}>{id} (missing item)</option>}
      {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
    </>
  );
  const needle = search.trim().toLowerCase();
  const visibleTables = Object.values(tables).filter((entry) => !needle || `${entry.id} ${entry.name}`.toLowerCase().includes(needle));

  return (
    <section className="engine-editor loot-editor">
      <header className="engine-editor-head">
        <div>
          <div className="engine-kicker">VISUAL LOOT AUTHORING</div>
          <h1>Loot tables</h1>
          <p>Build weighted chest, ground, and mob drops with item selectors, roll ranges, quantities, and live probability feedback.</p>
        </div>
        <div className="engine-revisions">
          <span className={meta.revision !== meta.publishedRevision ? 'dirty' : 'clean'}>{meta.revision !== meta.publishedRevision ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span>
          <small>draft r{meta.revision} / live r{meta.publishedRevision}</small>
        </div>
      </header>

      <div className="loot-workbench">
        <aside className="engine-records">
          <div className="engine-record-toolbar"><b>{Object.keys(tables).length} TABLES</b><button onClick={add}>+ NEW</button></div>
          <input className="engine-list-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loot tables..." />
          {visibleTables.map((entry) => (
            <button key={entry.id} className={selected === entry.id ? 'active' : ''} onClick={() => setSelected(entry.id)}>
              <span>{entry.name}</span><small>{entry.entries.length} entries / {entry.minRolls}-{entry.maxRolls} rolls</small>
            </button>
          ))}
        </aside>

        {table ? (
          <div className="loot-form">
            <div className="mob-form-head">
              <div><span>LOOT TABLE ID</span><b>{selected}</b></div>
              <div className="item-head-actions"><button onClick={duplicate}>DUPLICATE</button><button onClick={remove}>DELETE</button></div>
            </div>
            <div className="loot-summary-grid">
              <label>DISPLAY NAME<input value={table.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label>MINIMUM ROLLS<input type="number" min={1} max={100} value={table.minRolls} onChange={(event) => { const minRolls = Math.max(1, positiveNumber(event.target.value, 1)); patch({ minRolls, maxRolls: Math.max(minRolls, table.maxRolls) }); }} /></label>
              <label>MAXIMUM ROLLS<input type="number" min={table.minRolls} max={100} value={table.maxRolls} onChange={(event) => patch({ maxRolls: Math.max(table.minRolls, positiveNumber(event.target.value, table.minRolls)) })} /></label>
              <div className="loot-stat"><span>TOTAL WEIGHT</span><b>{totalWeight.toFixed(2)}</b></div>
              <div className="loot-stat"><span>AVERAGE ROLLS</span><b>{averageRolls.toFixed(1)}</b></div>
              <div className="loot-stat"><span>ITEM POOL</span><b>{table.entries.length}</b></div>
            </div>

            <div className="resource-drops-head">
              <div><span>WEIGHTED DROP POOL</span><b>{table.entries.length} ENTRIES</b></div>
              <button onClick={() => patch({ entries: [...table.entries, { id: items[0]?.id ?? 'wood', weight: 1, min: 1, max: 1 }] })}>+ ADD ITEM</button>
            </div>
            <div className="loot-entries">
              {table.entries.map((entry, index) => {
                const probability = totalWeight > 0 ? Math.max(0, entry.weight) / totalWeight : 0;
                const expected = probability * averageRolls;
                return (
                  <div className="loot-entry" key={`${index}:${entry.id}`}>
                    <div className="loot-entry-order"><button disabled={index === 0} onClick={() => moveEntry(index, -1)}>UP</button><button disabled={index === table.entries.length - 1} onClick={() => moveEntry(index, 1)}>DOWN</button></div>
                    <label>ITEM<select value={entry.id} onChange={(event) => patchEntry(index, { id: event.target.value })}>{itemOptions(String(entry.id))}</select></label>
                    <label>WEIGHT<input type="number" min={0.0001} step={0.1} value={entry.weight} onChange={(event) => patchEntry(index, { weight: Math.max(0.0001, positiveNumber(event.target.value, 1)) })} /></label>
                    <label>MIN QTY<input type="number" min={1} value={entry.min} onChange={(event) => { const min = Math.max(1, positiveNumber(event.target.value, 1)); patchEntry(index, { min, max: Math.max(min, entry.max) }); }} /></label>
                    <label>MAX QTY<input type="number" min={entry.min} value={entry.max} onChange={(event) => patchEntry(index, { max: Math.max(entry.min, positiveNumber(event.target.value, entry.min)) })} /></label>
                    <div className="loot-chance"><span>PER ROLL</span><b>{(probability * 100).toFixed(1)}%</b><small>{expected.toFixed(2)} expected/table</small></div>
                    <button className="loot-remove" onClick={() => patch({ entries: table.entries.filter((_, at) => at !== index) })}>REMOVE</button>
                  </div>
                );
              })}
              {table.entries.length === 0 && <div className="loot-empty">This table cannot be published until it contains at least one item.</div>}
            </div>
            <div className="loot-explainer"><b>HOW WEIGHTS WORK</b><span>Each roll chooses one row. An item with weight 20 in a pool totaling 100 has a 20% chance per roll. Quantity is then chosen between its minimum and maximum.</span></div>
            <div className="engine-actions">
              <span>{status}</span>
              <button onClick={() => void persistContentDraft('loot', tables, false, setStatus, setMeta)}>SAVE DRAFT</button>
              <button className="publish" onClick={() => void persistContentDraft('loot', tables, true, setStatus, setMeta)}>PUBLISH LIVE</button>
            </div>
          </div>
        ) : <div className="engine-empty">Create a loot table to begin.</div>}
      </div>
    </section>
  );
}

