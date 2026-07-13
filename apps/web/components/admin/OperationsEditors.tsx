'use client';

import { useCallback, useEffect, useState } from 'react';
import { ITEMS } from '@holdout/shared';

interface QuestRow {
  id: number;
  name: string;
  desc: string;
  kind: string;
  target: string;
  count: number;
  rewardMoney: number;
  rewardItem: string | null;
  rewardQty: number;
  requiresId: number | null;
  tier: number;
  active: boolean;
}

const EMPTY_QUEST: QuestRow = {
  id: 0, name: '', desc: '', kind: 'kill', target: 'zombie', count: 5,
  rewardMoney: 50, rewardItem: null, rewardQty: 1, requiresId: null, tier: 1, active: true,
};

export function QuestsEditor() {
  const [quests, setQuests] = useState<QuestRow[]>([]);
  const [mobs, setMobs] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<QuestRow>({ ...EMPTY_QUEST });
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const [questResponse, mobResponse] = await Promise.all([
      fetch('/api/admin/quests'), fetch('/api/admin/content/mobs'),
    ]);
    if (questResponse.ok) setQuests((await questResponse.json()).quests ?? []);
    if (mobResponse.ok) {
      const data = await mobResponse.json();
      const records = (data.published ?? data.draft ?? {}) as Record<string, { name?: string }>;
      setMobs(Object.entries(records).map(([id, mob]) => ({ id, name: mob.name ?? id })));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const set = (patch: Partial<QuestRow>) => setForm((current) => ({ ...current, ...patch }));
  const itemIds = Object.keys(ITEMS);

  const save = async () => {
    setStatus('Saving...');
    const response = await fetch('/api/admin/quests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, id: form.id || undefined }),
    });
    const data = await response.json();
    setStatus(response.ok ? 'Saved - live within one minute' : `Error: ${data.error}`);
    if (response.ok) { setForm({ ...EMPTY_QUEST }); void load(); }
  };

  const remove = async (id: number) => {
    await fetch('/api/admin/quests', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void load();
  };

  return (
    <div className="quests-editor admin-operations-editor">
      <div className="q-form">
        <h2>{form.id ? `EDIT QUEST #${form.id}` : 'NEW QUEST'}</h2>
        <label className="ed-label">NAME</label><input value={form.name} onChange={(event) => set({ name: event.target.value })} />
        <label className="ed-label">DESCRIPTION</label><input value={form.desc} onChange={(event) => set({ desc: event.target.value })} />
        <label className="ed-label">TYPE</label>
        <select value={form.kind} onChange={(event) => set({ kind: event.target.value, target: event.target.value === 'kill' ? (mobs[0]?.id ?? 'zombie') : 'wood' })}><option value="kill">Kill enemies</option><option value="fetch">Fetch items</option></select>
        <label className="ed-label">TARGET</label>
        {form.kind === 'kill'
          ? <select value={form.target} onChange={(event) => set({ target: event.target.value })}>{mobs.map((mob) => <option key={mob.id} value={mob.id}>{mob.name}</option>)}</select>
          : <select value={form.target} onChange={(event) => set({ target: event.target.value })}>{itemIds.map((id) => <option key={id} value={id}>{ITEMS[id as keyof typeof ITEMS].name}</option>)}</select>}
        <label className="ed-label">COUNT</label><input type="number" value={form.count} onChange={(event) => set({ count: Number(event.target.value) })} />
        <label className="ed-label">REWARD CREDITS</label><input type="number" value={form.rewardMoney} onChange={(event) => set({ rewardMoney: Number(event.target.value) })} />
        <label className="ed-label">REWARD ITEM</label>
        <select value={form.rewardItem ?? ''} onChange={(event) => set({ rewardItem: event.target.value || null })}><option value="">None</option>{itemIds.map((id) => <option key={id} value={id}>{ITEMS[id as keyof typeof ITEMS].name}</option>)}</select>
        {form.rewardItem && <><label className="ed-label">REWARD QUANTITY</label><input type="number" value={form.rewardQty} onChange={(event) => set({ rewardQty: Number(event.target.value) })} /></>}
        <label className="ed-label">TRADER TIER</label><select value={form.tier} onChange={(event) => set({ tier: Number(event.target.value) })}><option value={1}>1 - Outpost</option><option value={2}>2 - Black market</option></select>
        <label className="ed-label">REQUIRES QUEST</label><select value={form.requiresId ?? ''} onChange={(event) => set({ requiresId: event.target.value ? Number(event.target.value) : null })}><option value="">None</option>{quests.filter((quest) => quest.id !== form.id).map((quest) => <option key={quest.id} value={quest.id}>#{quest.id} {quest.name}</option>)}</select>
        <label className="ed-label"><input type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} /> ACTIVE</label>
        <button className="btn-primary" onClick={() => void save()}>{form.id ? 'UPDATE' : 'CREATE'}</button>
        {form.id !== 0 && <button className="q-cancel" onClick={() => setForm({ ...EMPTY_QUEST })}>NEW INSTEAD</button>}
        <div className="ed-status">{status}</div>
      </div>
      <div className="q-list">
        <h2>QUESTS ({quests.length})</h2>
        {quests.map((quest) => <div className="q-row" key={quest.id}><div className="q-body"><b>#{quest.id} {quest.name}</b>{!quest.active && <span className="q-off">INACTIVE</span>}<div className="q-meta">T{quest.tier} / {quest.kind} {quest.count} {quest.target} / {quest.rewardMoney}cr</div></div><button onClick={() => setForm(quest)}>EDIT</button><button onClick={() => void remove(quest.id)}>DELETE</button></div>)}
      </div>
    </div>
  );
}

interface ServerRow { id: number; name: string; region: string; url: string; active: boolean; sort: number }

export function ServersEditor() {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [form, setForm] = useState({ name: '', region: 'local', url: 'http://localhost:3001' });
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/servers');
    if (response.ok) setServers((await response.json()).servers ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const response = await fetch('/api/admin/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await response.json();
    setStatus(response.ok ? 'Server registered' : `Error: ${data.error}`);
    if (response.ok) { setForm({ name: '', region: 'local', url: '' }); void load(); }
  };

  const toggle = async (server: ServerRow) => {
    await fetch('/api/admin/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: server.id, active: !server.active }) });
    void load();
  };

  const remove = async (id: number) => {
    await fetch('/api/admin/servers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    void load();
  };

  return (
    <div className="quests-editor admin-operations-editor">
      <div className="q-form"><h2>REGISTER SERVER</h2><label className="ed-label">NAME</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><label className="ed-label">REGION</label><input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} /><label className="ed-label">SOCKET URL</label><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /><button className="btn-primary" onClick={() => void save()}>REGISTER</button><div className="ed-status">{status}</div></div>
      <div className="q-list"><h2>SERVERS ({servers.length})</h2>{servers.map((server) => <div className="q-row" key={server.id}><div className="q-body"><b>#{server.id} {server.name}</b>{!server.active && <span className="q-off">HIDDEN</span>}<div className="q-meta">{server.region} / {server.url}</div></div><button onClick={() => void toggle(server)}>{server.active ? 'HIDE' : 'SHOW'}</button><button onClick={() => void remove(server.id)}>DELETE</button></div>)}</div>
    </div>
  );
}
