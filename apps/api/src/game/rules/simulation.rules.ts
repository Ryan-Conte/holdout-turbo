import { Tile, type QuestDef } from '@holdout/shared';

export function actionInterruptedByMovement(startX: number, startY: number, x: number, y: number, tolerance = 14): boolean {
  return Math.hypot(x - startX, y - startY) > tolerance;
}

export function actionInterruptedByDamage(hasAction: boolean, damage: number): boolean {
  return hasAction && Number.isFinite(damage) && damage > 0;
}

export function fatigueMoveMultiplier(overweight: boolean, exhausted: boolean, penalty: number): number {
  return overweight || exhausted ? penalty : 1;
}

export function combatAttackAllowed(exhausted: boolean): boolean {
  return !exhausted;
}

export function clanHideoutExitTarget(hasWorldReturnPosition: boolean): 'safe_zone' | 'personal_hideout' {
  return hasWorldReturnPosition ? 'safe_zone' : 'personal_hideout';
}

export function elevationStepAllowed(from: number, to: number): boolean {
  return Math.abs(to - from) <= 1;
}

/**
 * A resource ID may only describe a node that still exists on the simulation
 * tile. Rock definitions also cover the copper/iron variants rolled at spawn.
 */
export function harvestResourceTileMatches(resourceTile: number, currentTile: number): boolean {
  return resourceTile === currentTile || (
    resourceTile === Tile.Rock &&
    (currentTile === Tile.CopperOre || currentTile === Tile.IronOre)
  );
}

export function questUnlocked(claimed: Record<string, boolean>, quest: Pick<QuestDef, 'requires'>): boolean {
  return quest.requires === null || Boolean(claimed[String(quest.requires)]);
}

export function questCanClaim(
  quest: Pick<QuestDef, 'kind' | 'count'>,
  progress: number,
  alreadyClaimed: boolean,
): boolean {
  return !alreadyClaimed && progress >= quest.count;
}

export function restoredStructureTile(under: number | undefined, fallback: number): number {
  return under ?? fallback;
}
