'use client';

import { useState } from 'react';

export interface FriendContact {
  id: string;
  name: string;
  status: string;
  incoming: boolean;
}

export type ClanRank = 'owner' | 'officer' | 'member';

export interface ClanMemberContact {
  id: string;
  name: string;
  rank: ClanRank;
  joinedAt: string;
}

export interface ClanSummary {
  id: string;
  name: string;
  tag: string;
  rank: ClanRank;
  treasury: number;
  ledger: { id: number; actor: string; kind: string; amount: number; balance: number; createdAt: string }[];
  members: ClanMemberContact[];
  outgoingInvites: { id: string; name: string; createdAt: string }[];
}

export interface ClanInvitation {
  clanId: string;
  name: string;
  tag: string;
  members: number;
  createdAt: string;
}

interface SocialPanelProps {
  friends: FriendContact[];
  username: string;
  message: string;
  canVisitCamps: boolean;
  clan: ClanSummary | null;
  clanInvitations: ClanInvitation[];
  clanName: string;
  clanTag: string;
  clanUsername: string;
  clanMessage: string;
  canEnterClanHoldout: boolean;
  onUsernameChange: (username: string) => void;
  onAddFriend: () => void;
  onAcceptFriend: (id: string) => void;
  onRemoveFriend: (id: string) => void;
  onVisitCamp: (id: string) => void;
  onClanNameChange: (name: string) => void;
  onClanTagChange: (tag: string) => void;
  onClanUsernameChange: (username: string) => void;
  onCreateClan: () => void;
  onInviteClanMember: () => void;
  onAcceptClanInvite: (clanId: string) => void;
  onDeclineClanInvite: (clanId: string) => void;
  onSetClanRank: (memberId: string, rank: 'officer' | 'member') => void;
  onTransferClan: (memberId: string) => void;
  onRemoveClanMember: (memberId: string) => void;
  onCancelClanInvite: (memberId: string) => void;
  onLeaveClan: () => void;
  onDisbandClan: () => void;
  onEnterClanHoldout: () => void;
  onClanTreasuryTransfer: (amount: number) => void;
}

export function SocialPanel(props: SocialPanelProps) {
  const [tab, setTab] = useState<'contacts' | 'clan'>('contacts');
  const [treasuryCredits, setTreasuryCredits] = useState('');
  const owner = props.clan?.rank === 'owner';
  const canWithdraw = props.clan?.rank === 'owner' || props.clan?.rank === 'officer';
  const transferTreasury = (direction: 1 | -1) => {
    const amount = Math.max(0, Math.min(100_000, Math.floor(Number(treasuryCredits) || 0)));
    if (!amount) return;
    props.onClanTreasuryTransfer(amount * direction);
    setTreasuryCredits('');
  };
  return (
    <div className="panel social-panel">
      <h3>COMMUNITY<span className="sub">P to close</span></h3>
      <div className="social-tabs">
        <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>CONTACTS</button>
        <button className={tab === 'clan' ? 'active' : ''} onClick={() => setTab('clan')}>CLAN{props.clanInvitations.length ? ` (${props.clanInvitations.length})` : ''}</button>
      </div>

      {tab === 'contacts' ? <>
        <div className="friend-add">
          <input
            placeholder="friend's callsign"
            value={props.username}
            onChange={(event) => props.onUsernameChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') props.onAddFriend(); event.stopPropagation(); }}
          />
          <button onClick={props.onAddFriend}>ADD</button>
        </div>
        <div className="friend-msg">{props.message}</div>
        {props.friends.length === 0 && <div className="item-desc">No contacts yet. Friends show up green on your tactical map.</div>}
        {props.friends.map((friend) => (
          <div className="friend-row" key={friend.id}>
            <span className={`f-dot ${friend.status}`} />
            <span className="f-name">{friend.name}</span>
            <span className="f-status">{friend.status === 'accepted' ? 'ally' : friend.incoming ? 'wants to ally' : 'pending'}</span>
            {friend.status === 'accepted' && props.canVisitCamps && <button onClick={() => props.onVisitCamp(friend.id)}>VISIT CAMP</button>}
            {friend.status !== 'accepted' && friend.incoming && <button onClick={() => props.onAcceptFriend(friend.id)}>ACCEPT</button>}
            {friend.status !== 'accepted' && friend.incoming && <button className="f-remove" onClick={() => props.onRemoveFriend(friend.id)}>DECLINE</button>}
            {friend.status !== 'accepted' && !friend.incoming && <button className="f-remove" onClick={() => props.onRemoveFriend(friend.id)}>CANCEL</button>}
            {friend.status === 'accepted' && <button className="f-remove" onClick={() => props.onRemoveFriend(friend.id)}>REMOVE</button>}
          </div>
        ))}
      </> : <>
        <div className="friend-msg">{props.clanMessage}</div>
        {!props.clan ? <>
          {props.clanInvitations.length > 0 && <div className="clan-section-title">PENDING INVITATIONS</div>}
          {props.clanInvitations.map((invite) => (
            <div className="clan-invite-row" key={invite.clanId}>
              <b>[{invite.tag}] {invite.name}</b><span>{invite.members}/40 members</span>
              <button onClick={() => props.onAcceptClanInvite(invite.clanId)}>JOIN</button>
              <button onClick={() => props.onDeclineClanInvite(invite.clanId)}>DECLINE</button>
            </div>
          ))}
          <div className="clan-section-title">FOUND A CLAN</div>
          <div className="clan-create">
            <input placeholder="clan name" maxLength={32} value={props.clanName} onChange={(event) => props.onClanNameChange(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
            <input className="clan-tag-input" placeholder="TAG" maxLength={6} value={props.clanTag} onChange={(event) => props.onClanTagChange(event.target.value.toUpperCase())} onKeyDown={(event) => event.stopPropagation()} />
            <button onClick={props.onCreateClan}>CREATE</button>
          </div>
          <p className="item-desc">Clans support up to 40 survivors and receive a shared 42×30 holdout with communal storage and permanent construction.</p>
        </> : <>
          <div className="clan-banner">
            <b>[{props.clan.tag}]</b>
            <span>{props.clan.name}</span>
            <em>{props.clan.rank}</em>
          </div>
          <div className="clan-holdout-card">
            <div><b>CLAN HOLDOUT</b><span>42×30 shared base · 24-slot core stash</span></div>
            <button disabled={!props.canEnterClanHoldout} onClick={props.onEnterClanHoldout}>{props.canEnterClanHoldout ? 'ENTER' : 'USE FROM HOME / SAFE ZONE'}</button>
          </div>
          <div className="clan-holdout-card">
            <div><b>CLAN TREASURY · {props.clan.treasury.toLocaleString()} CR</b><span>Pool raid profits for future clan upgrades and events.</span></div>
          </div>
          <div className="friend-add">
            <input
              inputMode="numeric"
              placeholder="credits"
              value={treasuryCredits}
              onChange={(event) => setTreasuryCredits(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              onKeyDown={(event) => { if (event.key === 'Enter') transferTreasury(1); event.stopPropagation(); }}
            />
            <button onClick={() => transferTreasury(1)}>CONTRIBUTE</button>
            {canWithdraw && <button onClick={() => transferTreasury(-1)}>WITHDRAW</button>}
          </div>
          {props.clan.ledger.length > 0 && <>
            <div className="clan-section-title">RECENT TREASURY ACTIVITY</div>
            {props.clan.ledger.slice(0, 6).map((entry) => (
              <div className="clan-member-row" key={entry.id}>
                <b>{entry.actor}</b>
                <em>{entry.kind === 'withdrawal' ? 'withdrew' : 'contributed'} {entry.amount.toLocaleString()} · {entry.balance.toLocaleString()} CR left</em>
              </div>
            ))}
          </>}
          {owner && <>
            <div className="clan-section-title">OWNER MANAGEMENT</div>
            <div className="friend-add">
              <input placeholder="invite survivor callsign" value={props.clanUsername} onChange={(event) => props.onClanUsernameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onInviteClanMember(); event.stopPropagation(); }} />
              <button onClick={props.onInviteClanMember}>INVITE</button>
            </div>
          </>}
          <div className="clan-section-title">ROSTER · {props.clan.members.length}/40</div>
          {props.clan.members.map((member) => (
            <div className="clan-member-row" key={member.id}>
              <span className={`clan-rank clan-rank-${member.rank}`}>{member.rank.slice(0, 1).toUpperCase()}</span>
              <b>{member.name}</b>
              <em>{member.rank}</em>
              {owner && member.rank !== 'owner' && <>
                <button onClick={() => props.onSetClanRank(member.id, member.rank === 'officer' ? 'member' : 'officer')}>{member.rank === 'officer' ? 'DEMOTE' : 'PROMOTE'}</button>
                <button onClick={() => props.onTransferClan(member.id)}>TRANSFER</button>
                <button className="danger" onClick={() => props.onRemoveClanMember(member.id)}>KICK</button>
              </>}
            </div>
          ))}
          {owner && props.clan.outgoingInvites.length > 0 && <>
            <div className="clan-section-title">OUTGOING INVITATIONS</div>
            {props.clan.outgoingInvites.map((invite) => <div className="clan-member-row" key={invite.id}><b>{invite.name}</b><em>pending</em><button onClick={() => props.onCancelClanInvite(invite.id)}>CANCEL</button></div>)}
          </>}
          <div className="clan-danger-zone">
            {owner ? <button onClick={props.onDisbandClan}>DISBAND CLAN</button> : <button onClick={props.onLeaveClan}>LEAVE CLAN</button>}
          </div>
        </>}
      </>}
    </div>
  );
}
