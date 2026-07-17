'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminActionPayload, AdminPanelState, RuntimeItemRegistry } from '@holdout/shared';
import { ItemIcon } from './ItemIcon';

interface AdminPanelProps {
  state: AdminPanelState | null;
  selfId: string;
  items: RuntimeItemRegistry;
  onAction: (action: AdminActionPayload) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function untilLabel(value: number) {
  if (!value || value <= Date.now()) return 'clear';
  return new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

export function AdminPanel({ state, selfId, items, onAction, onRefresh, onClose }: AdminPanelProps) {
  const [selectedId, setSelectedId] = useState(selfId);
  const [playerSearch, setPlayerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemId, setItemId] = useState('wood');
  const [quantity, setQuantity] = useState(1);
  const [tileX, setTileX] = useState(0);
  const [tileY, setTileY] = useState(0);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [announcement, setAnnouncement] = useState('');

  const players = state?.players ?? [];
  const selected = players.find((player) => player.id === selectedId) ?? players.find((player) => player.id === selfId) ?? players[0];
  const self = players.find((player) => player.id === selfId);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (!self) return;
    setTileX(self.tileX);
    setTileY(self.tileY);
  }, [self?.instanceId, self?.tileX, self?.tileY]);

  const filteredPlayers = useMemo(() => {
    const query = playerSearch.trim().toLowerCase();
    return players.filter((player) => !query || player.name.toLowerCase().includes(query) || player.instanceName.toLowerCase().includes(query));
  }, [playerSearch, players]);

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    return Object.values(items)
      .filter((item) => !query || item.id.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [itemSearch, items]);

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === itemId)) setItemId(filteredItems[0]?.id ?? '');
  }, [filteredItems, itemId]);

  const sanctionAllowed = Boolean(selected && selected.id !== selfId && !selected.admin);
  const act = (action: AdminActionPayload) => onAction(action);
  const confirmAction = (message: string, action: AdminActionPayload) => {
    if (window.confirm(message)) act(action);
  };

  return (
    <div className="panel admin-console" role="dialog" aria-label="Administrator world control console">
      <h3>
        WORLD CONTROL
        <span className="sub">SERVER-AUTHORIZED · F10</span>
      </h3>
      <div className="admin-console-head">
        <div><span>RELAY</span><b>{state?.server ?? 'Awaiting server…'}</b></div>
        <div className={state?.protected ? 'admin-protection active' : 'admin-protection'}>
          <span>PROTECTION</span><b>{state?.protected ? 'ACTIVE' : 'OFF'}</b>
        </div>
        <button onClick={onRefresh}>REFRESH</button>
        <button onClick={onClose}>CLOSE</button>
      </div>

      {!state ? <div className="admin-console-loading">VERIFYING ADMINISTRATOR ROLE…</div> : (
        <div className="admin-console-grid">
          <section className="admin-player-browser">
            <div className="admin-section-title">ONLINE SURVIVORS <em>{players.filter((player) => player.connected).length}</em></div>
            <input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Search player or instance" />
            <div className="admin-player-list">
              {filteredPlayers.map((player) => (
                <button key={player.id} className={player.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(player.id)}>
                  <i className={player.connected ? 'online' : ''} />
                  <span><b>{player.admin && <small>ADMIN</small>}{player.guest && <small>GUEST</small>}{player.name}</b><em>{player.instanceName}</em></span>
                  <strong>{player.dead ? 'DEAD' : `${player.hp} HP`}</strong>
                </button>
              ))}
              {filteredPlayers.length === 0 && <p>No matching survivors.</p>}
            </div>
          </section>

          <section className="admin-player-control">
            <div className="admin-section-title">TARGET CONTROL</div>
            {selected ? <>
              <div className="admin-target-card">
                <div className="admin-target-avatar">{selected.admin ? 'A' : selected.guest ? 'G' : selected.name.slice(0, 1).toUpperCase()}</div>
                <div><b>{selected.name}</b><span>{selected.instanceKind.replace('_', ' ')} · {selected.instanceName}</span><em>TILE {selected.tileX}, {selected.tileY} · {selected.connected ? 'CONNECTED' : 'COMBAT-LOG BODY'}</em></div>
                <strong className={selected.dead ? 'dead' : ''}>{selected.dead ? 'DEAD' : `${selected.hp}/${selected.maxHp}`}</strong>
              </div>
              <div className="admin-action-grid">
                <button onClick={() => act({ type: 'goto', targetId: selected.id })}>GO TO</button>
                <button onClick={() => act({ type: 'bring', targetId: selected.id })}>BRING</button>
                <button onClick={() => act({ type: 'send_home', targetId: selected.id })}>SEND HOME</button>
                <button disabled={selected.dead} onClick={() => act({ type: 'heal', targetId: selected.id })}>RESTORE</button>
              </div>

              <div className="admin-section-title">ISSUE ITEM</div>
              <div className="admin-item-tools">
                <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search active item database" />
                <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
                  {filteredItems.length === 0 && <option value="">No matching active items</option>}
                  {filteredItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
                </select>
                <div className="admin-item-issue">
                  <div>{items[itemId] && <ItemIcon id={itemId} size={28} />}<span>{items[itemId]?.name ?? itemId}</span></div>
                  <input aria-label="Item quantity" type="number" min={1} max={1000} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                  <button disabled={!items[itemId] || selected.dead} onClick={() => act({ type: 'give_item', targetId: selected.id, itemId, quantity })}>GIVE</button>
                </div>
              </div>

              <div className="admin-section-title danger">MODERATION</div>
              <input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="Reason shown to player and stored in audit" />
              <div className="admin-sanction-row">
                <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                  <option value={10}>10 minutes</option><option value={60}>1 hour</option><option value={1440}>24 hours</option>
                  <option value={10080}>7 days</option><option value={43200}>30 days</option>
                </select>
                <button disabled={!sanctionAllowed} onClick={() => act({ type: 'mute', targetId: selected.id, minutes, reason })}>MUTE</button>
                <button className="danger" disabled={!sanctionAllowed} onClick={() => confirmAction(`Kick ${selected.name}?`, { type: 'kick', targetId: selected.id, reason })}>KICK</button>
                <button className="danger solid" disabled={!sanctionAllowed} onClick={() => confirmAction(`Ban ${selected.name} for ${minutes} minutes?`, { type: 'ban', targetId: selected.id, minutes, reason })}>BAN</button>
              </div>
            </> : <p>No survivor selected.</p>}
          </section>

          <section className="admin-world-tools">
            <div className="admin-section-title">ADMIN TOOLS</div>
            <button className={state.protected ? 'admin-mode active' : 'admin-mode'} onClick={() => act({ type: 'protection', enabled: !state.protected })}>
              <b>{state.protected ? 'PROTECTED' : 'PROTECTION OFF'}</b><span>Invulnerability, full needs and unrestricted moderation sight</span>
            </button>

            <label>TELEPORT SELF · CURRENT INSTANCE</label>
            <div className="admin-coordinate-row">
              <input type="number" value={tileX} onChange={(event) => setTileX(Number(event.target.value))} aria-label="Tile X" />
              <input type="number" value={tileY} onChange={(event) => setTileY(Number(event.target.value))} aria-label="Tile Y" />
              <button onClick={() => act({ type: 'teleport', tileX, tileY })}>TELEPORT</button>
            </div>

            <label>SERVER ANNOUNCEMENT</label>
            <textarea value={announcement} maxLength={160} onChange={(event) => setAnnouncement(event.target.value)} placeholder="Broadcast to everyone connected to this relay" />
            <button className="admin-broadcast" onClick={() => { if (announcement.trim()) { act({ type: 'announce', message: announcement }); setAnnouncement(''); } }}>BROADCAST</button>

            <div className="admin-section-title">ACTIVE SANCTIONS <em>{state.sanctions.length}</em></div>
            <div className="admin-sanction-list">
              {state.sanctions.map((sanction) => (
                <div key={sanction.userId}>
                  <b>{sanction.name}</b>
                  {sanction.mutedUntil > Date.now() && <p><span>MUTED · {untilLabel(sanction.mutedUntil)}</span><em>{sanction.muteReason}</em><button onClick={() => act({ type: 'clear_mute', targetUserId: sanction.userId })}>LIFT</button></p>}
                  {sanction.bannedUntil > Date.now() && <p><span>BANNED · {untilLabel(sanction.bannedUntil)}</span><em>{sanction.banReason}</em><button onClick={() => act({ type: 'clear_ban', targetUserId: sanction.userId })}>LIFT</button></p>}
                </div>
              ))}
              {state.sanctions.length === 0 && <p className="empty">No active sanctions.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
