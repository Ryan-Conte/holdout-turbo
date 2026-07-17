const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addInventoryItem,
  canPayRecipe,
  collectCarriedDrops,
  countInventoryItem,
  removeInventoryItem,
} = require('../dist/game/rules/inventory.rules.js');
const { consumeFuel, planFuelAddition } = require('../dist/game/rules/station.rules.js');
const { canBuildClanHideout, canDemolishClanHideout, canManageClan, isClanRank } = require('../dist/game/rules/clan.rules.js');
const { adminItemQuantity, adminSanctionMinutes, adminText, adminTileCoordinate } = require('../dist/game/rules/admin.rules.js');
const {
  actionInterruptedByDamage,
  actionInterruptedByMovement,
  clanHideoutExitTarget,
  combatAttackAllowed,
  elevationStepAllowed,
  fatigueMoveMultiplier,
  questCanClaim,
  questUnlocked,
  restoredStructureTile,
} = require('../dist/game/rules/simulation.rules.js');
const { fromAuthored } = require('../dist/game/mapgen.js');
const { BACKPACKS, CLAN_HOLDOUT_H, CLAN_HOLDOUT_STORAGE_SLOTS, CLAN_HOLDOUT_W, HIDEOUT_H, HIDEOUT_STORAGE_SLOTS, HIDEOUT_W, ITEMS, RECIPES, TRADER_STOCK_T2, Tile } = require('@holdout/shared');

const items = {
  wood: { id: 'wood', name: 'Wood', kind: 'material', kg: 1, stack: 30, desc: '' },
  cloth: { id: 'cloth', name: 'Cloth', kind: 'material', kg: .1, stack: 20, desc: '' },
  axe: { id: 'axe', name: 'Axe', kind: 'tool', kg: 2, stack: 1, desc: '', durability: 180 },
  vest: { id: 'vest', name: 'Vest', kind: 'armor', kg: 3, stack: 1, desc: '', durability: 140 },
  mod: { id: 'mod', name: 'Mod', kind: 'mod', kg: .1, stack: 1, desc: '' },
};

test('inventory transfers preserve durability and enforce stack capacity', () => {
  const inventory = { backpack: 0, slots: [{ id: 'wood', qty: 29 }, null, null] };
  assert.equal(addInventoryItem(inventory, items, 'wood', 4), 0);
  assert.deepEqual(inventory.slots.slice(0, 2), [{ id: 'wood', qty: 30 }, { id: 'wood', qty: 3 }]);
  assert.equal(addInventoryItem(inventory, items, 'axe', 1, 37), 0);
  assert.deepEqual(inventory.slots[2], { id: 'axe', qty: 1, dur: 37 });
  assert.equal(removeInventoryItem(inventory, 'wood', 31), 31);
  assert.equal(countInventoryItem(inventory, 'wood'), 2);
});

test('death and disconnect loss collect every carried item without losing wear', () => {
  const inventory = { backpack: 0, slots: [{ id: 'axe', qty: 1, dur: 22 }, { id: 'wood', qty: 7 }] };
  const drops = collectCarriedDrops(inventory, { helmet: null, vest: 'vest', mod: 'mod' }, { vest: 63 }, items);
  assert.deepEqual(drops, [
    { id: 'axe', qty: 1, dur: 22 },
    { id: 'wood', qty: 7 },
    { id: 'vest', qty: 1, dur: 63 },
    { id: 'mod', qty: 1 },
  ]);
  assert.notEqual(drops[0], inventory.slots[0], 'drop records must not alias the saved inventory');
});

test('station fuel clamps additions and spends exactly one action charge', () => {
  assert.deepEqual(planFuelAddition(36, 5, 8, 40, 4), { wood: 1, fuel: 40 });
  assert.deepEqual(planFuelAddition(40, 1, 5, 40, 4), { wood: 0, fuel: 40 });
  assert.deepEqual(consumeFuel(1, 1), { consumed: true, fuel: 0 });
  assert.deepEqual(consumeFuel(0, 1), { consumed: false, fuel: 0 });
});

test('clan ranks enforce management and shared-hideout permissions', () => {
  assert.equal(isClanRank('owner'), true);
  assert.equal(isClanRank('visitor'), false);
  assert.equal(canManageClan('owner'), true);
  assert.equal(canManageClan('officer'), false);
  assert.equal(canBuildClanHideout('member'), true);
  assert.equal(canBuildClanHideout(null), false);
  assert.equal(canDemolishClanHideout('owner'), true);
  assert.equal(canDemolishClanHideout('officer'), true);
  assert.equal(canDemolishClanHideout('member'), false);
  assert.ok(CLAN_HOLDOUT_W > HIDEOUT_W);
  assert.ok(CLAN_HOLDOUT_H > HIDEOUT_H);
  assert.ok(CLAN_HOLDOUT_STORAGE_SLOTS > HIDEOUT_STORAGE_SLOTS);
});

test('clan holdout exits preserve safe-zone origins and otherwise return home', () => {
  assert.equal(clanHideoutExitTarget(true), 'safe_zone');
  assert.equal(clanHideoutExitTarget(false), 'personal_hideout');
});

test('MK4 backpack is a costly endgame capacity upgrade', () => {
  assert.equal(ITEMS.backpack_mk4.backpackTier, 3);
  assert.deepEqual(BACKPACKS[3], { name: 'Expedition Backpack MK4', slots: 32, maxKg: 80 });
  const recipe = RECIPES.find((entry) => entry.id === 'craft_backpack_mk4');
  assert.equal(recipe?.station, 'workbench');
  assert.deepEqual(recipe?.cost, [
    { id: 'cloth', qty: 24 },
    { id: 'scrap', qty: 20 },
    { id: 'iron_bar', qty: 10 },
    { id: 'animal_hide', qty: 8 },
  ]);
  assert.deepEqual(TRADER_STOCK_T2.find((entry) => entry.id === 'backpack_mk4'), { id: 'backpack_mk4', buy: 2500, sell: 350 });
});

test('admin inputs are bounded and control characters are stripped', () => {
  assert.equal(adminItemQuantity(50000), 1000);
  assert.equal(adminItemQuantity(-4), 1);
  assert.equal(adminSanctionMinutes(999999), 43200);
  assert.equal(adminSanctionMinutes('15'), 15);
  assert.equal(adminText('  griefing\n in chat  ', 30, 'No reason'), 'griefing in chat');
  assert.equal(adminText('\n', 30, 'No reason'), 'No reason');
  assert.equal(adminTileCoordinate(12.9, 20), 12);
  assert.equal(adminTileCoordinate(99, 20), 19);
  assert.equal(adminTileCoordinate('nope', 20), null);
});

test('crafting costs are deterministic and do not accept partial payment', () => {
  const inventory = { backpack: 0, slots: [{ id: 'wood', qty: 4 }, { id: 'cloth', qty: 1 }] };
  assert.equal(canPayRecipe(inventory, [{ id: 'wood', qty: 4 }, { id: 'cloth', qty: 1 }]), true);
  assert.equal(canPayRecipe(inventory, [{ id: 'wood', qty: 5 }]), false);
});

test('movement and damage interrupt extraction actions', () => {
  assert.equal(actionInterruptedByMovement(100, 100, 114, 100), false);
  assert.equal(actionInterruptedByMovement(100, 100, 115, 100), true);
  assert.equal(actionInterruptedByDamage(true, 1), true);
  assert.equal(actionInterruptedByDamage(false, 50), false);
});

test('exhaustion blocks combat and uses the overweight movement penalty without stacking', () => {
  assert.equal(combatAttackAllowed(false), true);
  assert.equal(combatAttackAllowed(true), false);
  assert.equal(fatigueMoveMultiplier(false, false, 0.45), 1);
  assert.equal(fatigueMoveMultiplier(true, false, 0.45), 0.45);
  assert.equal(fatigueMoveMultiplier(false, true, 0.45), 0.45);
  assert.equal(fatigueMoveMultiplier(true, true, 0.45), 0.45);
});

test('quest prerequisites and claims require the complete chain and progress', () => {
  const root = { requires: null, kind: 'kill', count: 2 };
  const child = { requires: 7, kind: 'fetch', count: 3 };
  assert.equal(questUnlocked({}, root), true);
  assert.equal(questUnlocked({}, child), false);
  assert.equal(questUnlocked({ 7: true }, child), true);
  assert.equal(questCanClaim(child, 2, false), false);
  assert.equal(questCanClaim(child, 3, false), true);
  assert.equal(questCanClaim(child, 3, true), false);
});

test('structure restoration keeps foundations and elevation rejects cliffs', () => {
  assert.equal(restoredStructureTile(17, 0), 17);
  assert.equal(restoredStructureTile(undefined, 0), 0);
  assert.equal(elevationStepAllowed(1, 2), true);
  assert.equal(elevationStepAllowed(1, 3), false);
});

test('authored map conversion preserves runtime content IDs, rotation and placements', () => {
  const width = 20;
  const height = 20;
  const tiles = new Array(width * height).fill(Tile.Grass);
  const resourceIndex = 2 * width + 3;
  tiles[resourceIndex] = Tile.Tree;
  const blockIndex = 4 * width + 5;
  const map = fromAuthored({
    w: width,
    h: height,
    tiles,
    elevations: new Array(width * height).fill(0),
    terrain: { 1: 'mud' },
    resources: { [resourceIndex]: 'ironwood' },
    blocks: { [blockIndex]: 'steel_crate' },
    blockRotations: { [blockIndex]: -1 },
    objects: [
      { type: 'spawn', x: 1, y: 1 },
      { type: 'extract', x: 18, y: 18 },
      { type: 'mob', x: 6, y: 7, contentId: 'brute', respawnMs: 12345 },
    ],
  });
  assert.equal(map.terrainKinds['1'], 'mud');
  assert.equal(map.resourceKinds[String(resourceIndex)], 'ironwood');
  assert.equal(map.blockKinds[String(blockIndex)], 'steel_crate');
  assert.equal(map.blockRotations[String(blockIndex)], 3);
  assert.equal(map.spawns.length, 1);
  assert.equal(map.extracts.length, 1);
  assert.deepEqual(map.enemySpawns[0].kind, 'brute');
  assert.equal(map.enemySpawns[0].respawnMs, 12345);
});
