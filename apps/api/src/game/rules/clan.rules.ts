export const CLAN_RANKS = ['owner', 'officer', 'member'] as const;
export type ClanRank = (typeof CLAN_RANKS)[number];

export function isClanRank(value: unknown): value is ClanRank {
  return typeof value === 'string' && (CLAN_RANKS as readonly string[]).includes(value);
}

export function canManageClan(rank: ClanRank | null | undefined): boolean {
  return rank === 'owner';
}

export function canBuildClanHideout(rank: ClanRank | null | undefined): boolean {
  return Boolean(rank && isClanRank(rank));
}

export function canDemolishClanHideout(rank: ClanRank | null | undefined): boolean {
  return rank === 'owner' || rank === 'officer';
}
