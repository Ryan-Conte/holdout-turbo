// Seeds the quest tree for testing: a tier-1 outpost chain that feeds into the
// tier-2 black-market chain. Wipes existing quests first (test data only).
// Usage: node tools/seed-quests.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// `requires` refers to the key of another entry; resolved to DB ids on insert.
const QUESTS = [
  // ── tier 1: outpost quartermaster — learn the loop
  { key: 't1_first_blood', name: 'First Blood', desc: 'The dead crowd the towns. Thin them out.', kind: 'kill', target: 'zombie', count: 3, rewardMoney: 40, rewardItem: 'bandage', rewardQty: 2, tier: 1, requires: null },
  { key: 't1_wolf_cull', name: 'Wolf Cull', desc: 'Wolves hunt the roads after dark. Make them regret it.', kind: 'kill', target: 'wolf', count: 2, rewardMoney: 80, rewardItem: 'ammo_9mm', rewardQty: 12, tier: 1, requires: 't1_first_blood' },
  { key: 't1_timber', name: 'Timber Contract', desc: 'The outpost palisade will not build itself. Bring lumber.', kind: 'fetch', target: 'wood', count: 20, rewardMoney: 60, rewardItem: null, rewardQty: 1, tier: 1, requires: 't1_first_blood' },
  { key: 't1_prospector', name: 'Prospector', desc: 'Ore-veined rocks glint in the wilds. Bring me copper.', kind: 'fetch', target: 'copper_ore', count: 4, rewardMoney: 90, rewardItem: 'pickaxe', rewardQty: 1, tier: 1, requires: 't1_timber' },
  { key: 't1_iron_age', name: 'Iron Age', desc: 'Smelt iron at a furnace. Industry is survival.', kind: 'fetch', target: 'iron_bar', count: 2, rewardMoney: 150, rewardItem: 'kit_anvil', rewardQty: 1, tier: 1, requires: 't1_prospector' },
  // ── tier 2: black-market dealer (hot zone) — harder, richer
  { key: 't2_military', name: 'Military Grade', desc: 'The airport patrols carry hardware I can move. Bring proof they no longer need it.', kind: 'kill', target: 'military', count: 5, rewardMoney: 260, rewardItem: 'attach_reddot', rewardQty: 1, tier: 2, requires: 't1_iron_age' },
  { key: 't2_drive', name: 'The Drive', desc: 'An encrypted drive circulates in the hot zone. It is worth more than your life.', kind: 'fetch', target: 'data_drive', count: 1, rewardMoney: 600, rewardItem: 'ammo_762', rewardQty: 20, tier: 2, requires: 't2_military' },
  { key: 't2_artifact', name: 'Impossible Geometry', desc: 'Bring me an artifact. Do not look at it too long.', kind: 'fetch', target: 'artifact', count: 1, rewardMoney: 1200, rewardItem: 'prototype_rifle', rewardQty: 1, tier: 2, requires: 't2_drive' },
];

const deleted = await prisma.quest.deleteMany({});
console.log(`cleared ${deleted.count} existing quests`);

const idByKey = new Map();
for (const q of QUESTS) {
  const row = await prisma.quest.create({
    data: {
      name: q.name,
      desc: q.desc,
      kind: q.kind,
      target: q.target,
      count: q.count,
      rewardMoney: q.rewardMoney,
      rewardItem: q.rewardItem,
      rewardQty: q.rewardQty,
      tier: q.tier,
      requiresId: q.requires ? idByKey.get(q.requires) : null,
      active: true,
    },
  });
  idByKey.set(q.key, row.id);
  console.log(`#${row.id} [T${q.tier}] ${q.name}${q.requires ? ` (requires #${idByKey.get(q.requires)})` : ''}`);
}

await prisma.$disconnect();
console.log('quest tree seeded');
