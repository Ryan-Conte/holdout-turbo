import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STORAGE = 'asset-rows-v1';

const spriteDocument = (value, fallback = { palette: ['#00000000'], assets: [] }) => ({
  palette: Array.isArray(value?.palette) ? value.palette : fallback.palette,
  assets: Array.isArray(value?.assets) ? value.assets : fallback.assets,
});

const manifest = (palette) => ({ palette, storage: STORAGE });

try {
  const existing = await prisma.gameContent.findUnique({ where: { kind: 'sprites' } });
  if (!existing) {
    console.log('No sprites content document exists; run npm run seed:engine first.');
    process.exitCode = 1;
  } else if (existing.draft?.storage === STORAGE) {
    const count = await prisma.gameSpriteAsset.count();
    console.log(`Sprite storage is already normalized (${count} asset rows, ${JSON.stringify(existing.draft).length} byte manifest).`);
  } else {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
      const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
      if (current.draft?.storage === STORAGE) {
        return { migrated: false, count: await tx.gameSpriteAsset.count() };
      }

      const draft = spriteDocument(current.draft);
      const published = current.published
        ? spriteDocument(current.published, { palette: draft.palette, assets: [] })
        : { palette: draft.palette, assets: [] };
      const draftAssets = new Map(draft.assets.map((asset) => [asset.id, asset]));
      const publishedAssets = new Map(published.assets.map((asset) => [asset.id, asset]));
      const assetIds = new Set([...draftAssets.keys(), ...publishedAssets.keys()]);

      for (const assetId of assetIds) {
        const draftAsset = draftAssets.get(assetId);
        const publishedAsset = publishedAssets.get(assetId);
        await tx.gameSpriteAsset.upsert({
          where: { assetId },
          create: {
            assetId,
            draft: draftAsset ?? publishedAsset,
            published: publishedAsset ?? draftAsset,
            draftDeleted: !draftAsset,
            publishedDeleted: !publishedAsset,
            draftRevision: current.revision,
            publishedRevision: publishedAsset ? current.publishedRevision : 0,
            updatedBy: current.updatedBy,
            updatedAt: current.updatedAt,
            publishedAt: publishedAsset ? current.publishedAt : null,
          },
          update: {},
        });
        await tx.gameSpriteAssetRevision.upsert({
          where: { assetId_revision: { assetId, revision: current.revision } },
          create: {
            assetId,
            revision: current.revision,
            data: draftAsset ?? {},
            deleted: !draftAsset,
            published: current.publishedRevision === current.revision,
            createdBy: current.updatedBy,
          },
          update: {},
        });
      }

      const draftManifest = manifest(draft.palette);
      await tx.gameContent.update({
        where: { kind: 'sprites' },
        data: { draft: draftManifest, published: manifest(published.palette) },
      });
      await tx.gameContentRevision.upsert({
        where: { kind_revision: { kind: 'sprites', revision: current.revision } },
        create: {
          kind: 'sprites',
          revision: current.revision,
          data: draftManifest,
          published: current.publishedRevision === current.revision,
          createdBy: current.updatedBy,
        },
        update: { data: draftManifest },
      });
      return { migrated: true, count: assetIds.size };
    }, { maxWait: 15_000, timeout: 120_000 });
    console.log(result.migrated
      ? `Migrated ${result.count} sprites into independent asset rows.`
      : `Sprite storage was already normalized (${result.count} asset rows).`);
  }
} finally {
  await prisma.$disconnect();
}
