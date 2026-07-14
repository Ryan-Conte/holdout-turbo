import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { generateShowcaseMap, renderShowcasePreview, SHOWCASE_MAP_NAME } from './lib/showcase-map.mjs';

const prisma = new PrismaClient();
const previewArg = process.argv.find((argument) => argument.startsWith('--preview='));
const dryRun = process.argv.includes('--dry-run');

try {
  const rows = await prisma.gameContent.findMany({
    where: { kind: { in: ['terrain', 'blocks', 'resources', 'mobs', 'loot'] } },
    select: { kind: true, draft: true, published: true },
  });
  const documents = Object.fromEntries(rows.map((row) => [row.kind, row.published ?? row.draft]));
  const terrainDefs = documents.terrain ?? {};
  const blockDefs = documents.blocks?.world ?? {};
  const resourceDefs = documents.resources ?? {};
  const mobDefs = documents.mobs ?? {};
  const lootDefs = documents.loot ?? {};

  const { map, report } = generateShowcaseMap({ terrainDefs, blockDefs, resourceDefs, mobDefs, lootDefs });
  const previousActive = await prisma.gameMap.findFirst({ where: { active: true, draft: false }, select: { id: true, name: true } });

  let previewPath = null;
  if (previewArg) {
    previewPath = resolve(previewArg.slice('--preview='.length));
    writeFileSync(previewPath, renderShowcasePreview(map, terrainDefs));
  }

  let result = null;
  if (!dryRun) {
    const existingDraft = await prisma.gameMap.findFirst({ where: { name: SHOWCASE_MAP_NAME, draft: true }, orderBy: { updatedAt: 'desc' } });
    result = await prisma.$transaction(async (transaction) => {
      await transaction.gameMap.updateMany({ where: { active: true }, data: { active: false } });
      const draft = existingDraft
        ? await transaction.gameMap.update({ where: { id: existingDraft.id }, data: { data: map, active: false, draft: true, updatedAt: new Date() } })
        : await transaction.gameMap.create({ data: { name: SHOWCASE_MAP_NAME, data: map, active: false, draft: true } });
      const published = await transaction.gameMap.create({ data: { name: SHOWCASE_MAP_NAME, data: map, active: true, draft: false } });
      return { draft, published };
    });
  }

  console.log(JSON.stringify({
    name: SHOWCASE_MAP_NAME,
    dryRun,
    draftId: result?.draft.id ?? null,
    publishedId: result?.published.id ?? null,
    replacedActive: dryRun ? null : previousActive,
    previewPath,
    report,
    note: 'The API will load this publication when its current world has no connected players.',
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
