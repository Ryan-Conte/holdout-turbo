import type { PixelAsset, SpriteDocument } from '@holdout/shared';
import { Prisma as PrismaClientTypes } from '@prisma/client';
import { prisma } from './db';
import { defaultGameContent, sanitizeGameContent } from './game-content';

const SPRITE_STORAGE = 'asset-rows-v1';

type SpriteManifest = {
  palette: string[];
  storage: typeof SPRITE_STORAGE;
};

type SpriteChannel = 'draft' | 'published';

function fallbackDocument(): SpriteDocument {
  return defaultGameContent('sprites') as SpriteDocument;
}

const fallbackSources = new Map(
  fallbackDocument().assets.flatMap((asset) =>
    asset.source ? [[asset.id, asset.source] as const] : [],
  ),
);

function spriteDocument(value: unknown, fallback = fallbackDocument()): SpriteDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const candidate = value as Partial<SpriteDocument>;
  return {
    palette: Array.isArray(candidate.palette) ? candidate.palette : fallback.palette,
    assets: Array.isArray(candidate.assets) ? candidate.assets : [],
  };
}

function isManifest(value: unknown): value is SpriteManifest {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { storage?: unknown }).storage === SPRITE_STORAGE);
}

function manifest(palette: string[]): SpriteManifest {
  return { palette, storage: SPRITE_STORAGE };
}

function json(value: unknown): PrismaClientTypes.InputJsonValue {
  return value as PrismaClientTypes.InputJsonValue;
}

function pixelAsset(value: PrismaClientTypes.JsonValue): PixelAsset {
  const asset = value as unknown as PixelAsset;
  const fallbackSource = fallbackSources.get(asset.id);
  return !asset.source && fallbackSource
    ? { ...asset, source: { ...fallbackSource } }
    : asset;
}

function metadataAsset(asset: PixelAsset): PixelAsset {
  return { ...asset, pixels: [], frames: [] };
}

/**
 * One-time, lossless migration from the original monolithic sprites document.
 * Old revision snapshots remain readable; all new revisions are sparse.
 */
export async function ensureSpriteAssetStorage(userId: string) {
  const fallback = fallbackDocument();
  const existing = await prisma.gameContent.findUnique({ where: { kind: 'sprites' } });
  if (existing && isManifest(existing.draft)) return existing;
  if (!existing) {
    await prisma.gameContent.create({
      data: {
        kind: 'sprites',
        draft: json(fallback),
        published: json(fallback),
        publishedRevision: 1,
        updatedBy: userId,
        publishedAt: new Date(),
      },
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
    if (isManifest(current.draft)) return current;

    const draft = spriteDocument(current.draft);
    const published = current.published ? spriteDocument(current.published, { palette: draft.palette, assets: [] }) : { palette: draft.palette, assets: [] };
    const draftAssets = new Map(draft.assets.map((asset) => [asset.id, asset]));
    const publishedAssets = new Map(published.assets.map((asset) => [asset.id, asset]));
    const assetIds = new Set([...draftAssets.keys(), ...publishedAssets.keys()]);

    for (const assetId of assetIds) {
      const draftAsset = draftAssets.get(assetId);
      const publishedAsset = publishedAssets.get(assetId);
      const storedDraft = draftAsset ?? publishedAsset!;
      const storedPublished = publishedAsset ?? draftAsset!;
      await tx.gameSpriteAsset.upsert({
        where: { assetId },
        create: {
          assetId,
          draft: json(storedDraft),
          published: json(storedPublished),
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
          data: json(draftAsset ?? {}),
          deleted: !draftAsset,
          published: current.publishedRevision === current.revision,
          createdBy: current.updatedBy,
        },
        update: {},
      });
    }

    const draftManifest = manifest(draft.palette);
    const publishedManifest = manifest(published.palette);
    const migrated = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: { draft: json(draftManifest), published: json(publishedManifest) },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: 'sprites', revision: current.revision } },
      create: {
        kind: 'sprites',
        revision: current.revision,
        data: json(draftManifest),
        published: current.publishedRevision === current.revision,
        createdBy: current.updatedBy,
      },
      update: { data: json(draftManifest) },
    });
    return migrated;
  }, { maxWait: 15_000, timeout: 120_000 });
}

function rowsToDocument(
  content: Awaited<ReturnType<typeof ensureSpriteAssetStorage>>,
  rows: Awaited<ReturnType<typeof prisma.gameSpriteAsset.findMany>>,
  channel: SpriteChannel,
  metadataOnly: boolean,
) {
  const source = channel === 'draft' ? content.draft : content.published;
  const palette = spriteDocument(source, { palette: fallbackDocument().palette, assets: [] }).palette;
  const assets = rows.flatMap((row) => {
    const deleted = channel === 'draft' ? row.draftDeleted : row.publishedDeleted;
    if (deleted) return [];
    const asset = pixelAsset(channel === 'draft' ? row.draft : row.published);
    return [metadataOnly ? metadataAsset(asset) : asset];
  });
  return { palette, assets } satisfies SpriteDocument;
}

export async function readSpriteContent(userId: string, options?: { include?: 'all' | SpriteChannel; assetId?: string }) {
  const row = await ensureSpriteAssetStorage(userId);
  if (options?.assetId) {
    const asset = await prisma.gameSpriteAsset.findUnique({ where: { assetId: options.assetId } });
    return {
      row,
      draft: asset && !asset.draftDeleted ? pixelAsset(asset.draft) : null,
      published: asset && !asset.publishedDeleted ? pixelAsset(asset.published) : null,
    };
  }
  const include = options?.include;
  const rows = await prisma.gameSpriteAsset.findMany({ orderBy: { assetId: 'asc' } });
  const draft = rowsToDocument(row, rows, 'draft', include !== 'all' && include !== 'draft');
  const published = rowsToDocument(row, rows, 'published', include !== 'all' && include !== 'published');
  return { row, draft, published };
}

async function recordManifestRevision(
  tx: PrismaClientTypes.TransactionClient,
  revision: number,
  palette: string[],
  userId: string,
) {
  const data = manifest(palette);
  await tx.gameContentRevision.upsert({
    where: { kind_revision: { kind: 'sprites', revision } },
    create: { kind: 'sprites', revision, data: json(data), createdBy: userId },
    update: { data: json(data), createdBy: userId },
  });
}

export async function saveSpriteAsset(assetInput: unknown, paletteInput: unknown, userId: string) {
  const rawId = assetInput && typeof assetInput === 'object' && !Array.isArray(assetInput)
    ? (assetInput as { id?: unknown }).id
    : undefined;
  if (typeof rawId !== 'string' || !rawId.trim()) throw new Error('Sprite id is required');
  return saveSpriteAssets([assetInput], paletteInput, userId);
}

export async function saveSpriteAssets(assetInputs: unknown[], paletteInput: unknown, userId: string) {
  if (!Array.isArray(assetInputs) || assetInputs.length === 0) throw new Error('At least one sprite asset is required');
  const sanitized = sanitizeGameContent('sprites', {
    ...(paletteInput !== undefined ? { palette: paletteInput } : {}),
    assets: assetInputs,
  }) as SpriteDocument;
  if (sanitized.assets.length !== assetInputs.length) throw new Error('One or more sprite assets are invalid');
  await ensureSpriteAssetStorage(userId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
    const currentPalette = spriteDocument(current.draft).palette;
    const palette = paletteInput === undefined ? currentPalette : sanitized.palette;
    const revision = current.revision + 1;
    for (const asset of sanitized.assets) {
      await tx.gameSpriteAsset.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          draft: json(asset),
          published: json(asset),
          draftDeleted: false,
          publishedDeleted: true,
          draftRevision: revision,
          updatedBy: userId,
        },
        update: {
          draft: json(asset),
          draftDeleted: false,
          draftRevision: revision,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      await tx.gameSpriteAssetRevision.upsert({
        where: { assetId_revision: { assetId: asset.id, revision } },
        create: { assetId: asset.id, revision, data: json(asset), createdBy: userId },
        update: { data: json(asset), deleted: false, createdBy: userId },
      });
    }
    const saved = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: { draft: json(manifest(palette)), revision, updatedBy: userId, updatedAt: new Date() },
    });
    await recordManifestRevision(tx, revision, palette, userId);
    return saved;
  }, { maxWait: 15_000, timeout: 120_000 });
}

export async function saveSpriteDocument(draftInput: unknown, userId: string) {
  const draft = sanitizeGameContent('sprites', draftInput) as SpriteDocument;
  await ensureSpriteAssetStorage(userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
    const revision = current.revision + 1;
    const existing = await tx.gameSpriteAsset.findMany();
    const incoming = new Map(draft.assets.map((asset) => [asset.id, asset]));

    for (const asset of draft.assets) {
      await tx.gameSpriteAsset.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          draft: json(asset),
          published: json(asset),
          draftDeleted: false,
          publishedDeleted: true,
          draftRevision: revision,
          updatedBy: userId,
        },
        update: { draft: json(asset), draftDeleted: false, draftRevision: revision, updatedBy: userId, updatedAt: new Date() },
      });
      await tx.gameSpriteAssetRevision.upsert({
        where: { assetId_revision: { assetId: asset.id, revision } },
        create: { assetId: asset.id, revision, data: json(asset), createdBy: userId },
        update: { data: json(asset), deleted: false, createdBy: userId },
      });
    }
    for (const asset of existing) {
      if (incoming.has(asset.assetId) || asset.draftDeleted) continue;
      await tx.gameSpriteAsset.update({
        where: { assetId: asset.assetId },
        data: { draftDeleted: true, draftRevision: revision, updatedBy: userId, updatedAt: new Date() },
      });
      await tx.gameSpriteAssetRevision.upsert({
        where: { assetId_revision: { assetId: asset.assetId, revision } },
        create: { assetId: asset.assetId, revision, data: json({}), deleted: true, createdBy: userId },
        update: { data: json({}), deleted: true, createdBy: userId },
      });
    }
    const saved = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: { draft: json(manifest(draft.palette)), revision, updatedBy: userId, updatedAt: new Date() },
    });
    await recordManifestRevision(tx, revision, draft.palette, userId);
    return saved;
  }, { maxWait: 15_000, timeout: 120_000 });
}

export async function deleteSpriteAsset(assetId: string, userId: string) {
  await ensureSpriteAssetStorage(userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
    const asset = await tx.gameSpriteAsset.findUnique({ where: { assetId } });
    if (!asset || asset.draftDeleted) return { row: current, deleted: false };
    const revision = current.revision + 1;
    await tx.gameSpriteAsset.update({
      where: { assetId },
      data: { draftDeleted: true, draftRevision: revision, updatedBy: userId, updatedAt: new Date() },
    });
    await tx.gameSpriteAssetRevision.upsert({
      where: { assetId_revision: { assetId, revision } },
      create: { assetId, revision, data: json({}), deleted: true, createdBy: userId },
      update: { data: json({}), deleted: true, createdBy: userId },
    });
    const palette = spriteDocument(current.draft).palette;
    const row = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: { revision, updatedBy: userId, updatedAt: new Date() },
    });
    await recordManifestRevision(tx, revision, palette, userId);
    return { row, deleted: true };
  });
}

export async function publishSprites(userId: string) {
  await ensureSpriteAssetStorage(userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const current = await tx.gameContent.findUniqueOrThrow({ where: { kind: 'sprites' } });
    const publishedAt = new Date();
    await tx.$executeRaw`
      UPDATE "game_sprite_assets"
      SET "published" = "draft",
          "published_deleted" = "draft_deleted",
          "published_revision" = ${current.revision},
          "published_at" = ${publishedAt}
    `;
    await tx.$executeRaw`
      UPDATE "game_sprite_asset_revisions" AS revision
      SET "published" = true
      FROM "game_sprite_assets" AS asset
      WHERE revision."asset_id" = asset."asset_id"
        AND revision."revision" = asset."draft_revision"
    `;
    const palette = spriteDocument(current.draft).palette;
    const saved = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: {
        published: json(manifest(palette)),
        publishedRevision: current.revision,
        publishedAt,
        updatedBy: userId,
      },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: 'sprites', revision: current.revision } },
      create: { kind: 'sprites', revision: current.revision, data: json(manifest(palette)), published: true, createdBy: userId },
      update: { data: json(manifest(palette)), published: true },
    });
    return saved;
  }, { maxWait: 15_000, timeout: 120_000 });
}

async function documentAtRevision(revision: number, snapshot: PrismaClientTypes.JsonValue) {
  if (!isManifest(snapshot)) return sanitizeGameContent('sprites', snapshot) as SpriteDocument;
  const changes = await prisma.gameSpriteAssetRevision.findMany({
    where: { revision: { lte: revision } },
    orderBy: [{ assetId: 'asc' }, { revision: 'desc' }],
  });
  const latest = new Map<string, (typeof changes)[number]>();
  for (const change of changes) if (!latest.has(change.assetId)) latest.set(change.assetId, change);
  const assets = [...latest.values()].flatMap((change) => change.deleted ? [] : [pixelAsset(change.data)]);
  return { palette: spriteDocument(snapshot).palette, assets } satisfies SpriteDocument;
}

export async function restoreSprites(revision: number, publish: boolean, userId: string) {
  await ensureSpriteAssetStorage(userId);
  const [snapshot, current] = await Promise.all([
    prisma.gameContentRevision.findUnique({ where: { kind_revision: { kind: 'sprites', revision } } }),
    prisma.gameContent.findUnique({ where: { kind: 'sprites' } }),
  ]);
  if (!snapshot || !current) return null;
  const restored = await documentAtRevision(revision, snapshot.data);
  const nextRevision = current.revision + 1;
  const incoming = new Map(restored.assets.map((asset) => [asset.id, asset]));

  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "game_content" WHERE "kind" = 'sprites' FOR UPDATE`;
    const existing = await tx.gameSpriteAsset.findMany();
    for (const asset of restored.assets) {
      await tx.gameSpriteAsset.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          draft: json(asset),
          published: json(asset),
          draftDeleted: false,
          publishedDeleted: !publish,
          draftRevision: nextRevision,
          publishedRevision: publish ? nextRevision : 0,
          updatedBy: userId,
          publishedAt: publish ? new Date() : null,
        },
        update: {
          draft: json(asset),
          draftDeleted: false,
          draftRevision: nextRevision,
          ...(publish ? { published: json(asset), publishedDeleted: false, publishedRevision: nextRevision, publishedAt: new Date() } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      await tx.gameSpriteAssetRevision.create({
        data: { assetId: asset.id, revision: nextRevision, data: json(asset), published: publish, createdBy: userId },
      });
    }
    for (const asset of existing) {
      if (incoming.has(asset.assetId)) continue;
      await tx.gameSpriteAsset.update({
        where: { assetId: asset.assetId },
        data: {
          draftDeleted: true,
          draftRevision: nextRevision,
          ...(publish ? { publishedDeleted: true, publishedRevision: nextRevision, publishedAt: new Date() } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      await tx.gameSpriteAssetRevision.create({
        data: { assetId: asset.assetId, revision: nextRevision, data: json({}), deleted: true, published: publish, createdBy: userId },
      });
    }
    const draftManifest = manifest(restored.palette);
    const saved = await tx.gameContent.update({
      where: { kind: 'sprites' },
      data: {
        draft: json(draftManifest),
        revision: nextRevision,
        ...(publish ? { published: json(draftManifest), publishedRevision: nextRevision, publishedAt: new Date() } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });
    await tx.gameContentRevision.create({
      data: { kind: 'sprites', revision: nextRevision, data: json(draftManifest), published: publish, createdBy: userId },
    });
    return saved;
  }, { maxWait: 15_000, timeout: 120_000 });
  return { row, restoredFrom: revision };
}
