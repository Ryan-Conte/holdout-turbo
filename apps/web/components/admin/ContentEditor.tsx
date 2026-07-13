'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EngineContentKind } from '@holdout/shared';

const LABELS: Record<EngineContentKind, { title: string; description: string; singular: string }> = {
  items: { title: 'Items', singular: 'item', description: 'Weights, stacks, use flags, combat stats, durability and item restrictions.' },
  recipes: { title: 'Crafting recipes', singular: 'recipe', description: 'Outputs, ingredient costs, categories and required stations.' },
  mobs: { title: 'Mobs and bosses', singular: 'mob', description: 'AI behavior, health, damage, speed, drops, respawns and sprite links.' },
  loot: { title: 'Loot tables', singular: 'table', description: 'Chest contents, ground loot and per-mob drop rates.' },
  traders: { title: 'Traders', singular: 'trader', description: 'Buy/sell prices, trader identity and the quest tier linked to each trader.' },
  blocks: { title: 'Blocks', singular: 'block', description: 'Placeable structures, durability, tile mapping and hideout restrictions.' },
  sprites: { title: 'Pixel art', singular: 'sprite', description: 'Editable sprite assets stored alongside game content.' },
  animations: { title: 'Animations', singular: 'profile', description: 'Player and mob state clips, frame order, speed and looping.' },
  resources: { title: 'Resource nodes', singular: 'resource', description: 'Harvest health, respawns, drops, sprites and action sounds.' },
  terrain: { title: 'Terrain', singular: 'terrain', description: 'Ground art, traversal, collision and environmental sound behavior.' },
  sounds: { title: 'Sound library', singular: 'sound', description: 'Reusable synthesized sound presets and action mappings.' },
  settings: { title: 'Engine settings', singular: 'setting', description: 'Global restrictions and tuning as runtime systems migrate into the engine.' },
};

interface ContentResponse {
  draft: unknown;
  revision: number;
  publishedRevision: number;
  publishedAt: string | null;
}

function entriesOf(document: unknown): [string, unknown][] {
  if (Array.isArray(document)) return document.map((value, index) => [String(index), value]);
  if (document && typeof document === 'object') return Object.entries(document as Record<string, unknown>);
  return [];
}

function replaceEntry(document: unknown, key: string, value: unknown): unknown {
  if (Array.isArray(document)) {
    const next = document.slice();
    next[Number(key)] = value;
    return next;
  }
  return { ...(document as Record<string, unknown>), [key]: value };
}

export function ContentEditor({ kind }: { kind: Exclude<EngineContentKind, 'sprites'> }) {
  const info = LABELS[kind];
  const [document, setDocument] = useState<unknown>({});
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState('{}');
  const [meta, setMeta] = useState({ revision: 0, publishedRevision: 0, publishedAt: '' as string | null });
  const [status, setStatus] = useState('Loading draft...');

  const select = useCallback((key: string, value: unknown) => {
    setSelected(key);
    setEditor(JSON.stringify(value, null, 2));
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/content/${kind}`, { cache: 'no-store' });
    const data = await res.json() as ContentResponse & { error?: string };
    if (!res.ok) {
      setStatus(data.error ?? 'Could not load content');
      return;
    }
    setDocument(data.draft);
    setMeta({ revision: data.revision, publishedRevision: data.publishedRevision, publishedAt: data.publishedAt });
    const first = entriesOf(data.draft)[0];
    if (first) select(first[0], first[1]);
    setStatus('Draft loaded');
  }, [kind, select]);

  useEffect(() => { void load(); }, [load]);

  const materializeEditor = (): unknown => {
    if (!selected) return document;
    return replaceEntry(document, selected, JSON.parse(editor));
  };

  const saveDraft = async (): Promise<boolean> => {
    let next: unknown;
    try {
      next = materializeEditor();
    } catch {
      setStatus('The selected JSON is not valid');
      return false;
    }
    setStatus('Validating and saving draft...');
    const res = await fetch(`/api/admin/content/${kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? 'Draft save failed');
      return false;
    }
    setDocument(next);
    setMeta((m) => ({ ...m, revision: data.revision }));
    setStatus(`Draft revision ${data.revision} saved`);
    return true;
  };

  const publish = async () => {
    if (!await saveDraft()) return;
    setStatus('Publishing validated draft...');
    const res = await fetch(`/api/admin/content/${kind}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? 'Publish failed');
      return;
    }
    setMeta((m) => ({ ...m, publishedRevision: data.publishedRevision, publishedAt: data.publishedAt }));
    setStatus(`Published revision ${data.publishedRevision}. Game servers poll for updates.`);
  };

  const add = () => {
    if (Array.isArray(document)) {
      const next = [...document, { id: `new_${kind}_${document.length + 1}` }];
      setDocument(next);
      select(String(next.length - 1), next[next.length - 1]);
      return;
    }
    const requested = window.prompt(`New ${info.singular} id`, `new_${info.singular}`);
    const key = requested?.trim().replace(/[^a-z0-9_-]/gi, '_');
    if (!key) return;
    const value = { id: key, name: `New ${info.singular}` };
    const next = { ...(document as Record<string, unknown>), [key]: value };
    setDocument(next);
    select(key, value);
  };

  const remove = () => {
    if (!selected || !window.confirm(`Delete ${selected} from this draft?`)) return;
    if (Array.isArray(document)) {
      const next = document.filter((_, index) => index !== Number(selected));
      setDocument(next);
      const first = entriesOf(next)[0];
      if (first) select(first[0], first[1]); else setSelected('');
      return;
    }
    const next = { ...(document as Record<string, unknown>) };
    delete next[selected];
    setDocument(next);
    const first = entriesOf(next)[0];
    if (first) select(first[0], first[1]); else setSelected('');
  };

  const entries = entriesOf(document);
  const dirty = meta.revision !== meta.publishedRevision;

  return (
    <section className="engine-editor">
      <header className="engine-editor-head">
        <div>
          <div className="engine-kicker">CONTENT DOCUMENT</div>
          <h1>{info.title}</h1>
          <p>{info.description}</p>
        </div>
        <div className="engine-revisions">
          <span className={dirty ? 'dirty' : 'clean'}>{dirty ? 'UNPUBLISHED CHANGES' : 'LIVE'}</span>
          <small>draft r{meta.revision} / live r{meta.publishedRevision}</small>
        </div>
      </header>
      <div className="engine-workbench">
        <aside className="engine-records">
          <div className="engine-record-toolbar">
            <b>{entries.length} RECORDS</b>
            <button onClick={add}>+ NEW</button>
          </div>
          {entries.map(([key, value]) => {
            const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
            return (
              <button className={selected === key ? 'active' : ''} key={key} onClick={() => select(key, value)}>
                <span>{String(row.name ?? row.id ?? key)}</span>
                <small>{key}</small>
              </button>
            );
          })}
        </aside>
        <div className="engine-json-panel">
          <div className="engine-json-title">
            <b>{selected || 'No record selected'}</b>
            <button disabled={!selected} onClick={remove}>DELETE</button>
          </div>
          <textarea value={editor} onChange={(event) => setEditor(event.target.value)} spellCheck={false} />
          <div className="engine-actions">
            <span>{status}</span>
            <button onClick={saveDraft}>SAVE DRAFT</button>
            <button className="publish" onClick={publish}>PUBLISH LIVE</button>
          </div>
        </div>
      </div>
    </section>
  );
}
