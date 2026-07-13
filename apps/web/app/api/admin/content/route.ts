import { NextResponse } from 'next/server';
import { ENGINE_CONTENT_KINDS, type EngineContentKind } from '@holdout/shared';
import { requireAdmin } from '@/lib/auth';
import { defaultGameContent } from '@/lib/game-content';
import { prisma } from '@/lib/db';

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  await Promise.all(ENGINE_CONTENT_KINDS.map((kind) => prisma.gameContent.upsert({
    where: { kind },
    create: {
      kind,
      draft: defaultGameContent(kind as EngineContentKind) as object,
      published: defaultGameContent(kind as EngineContentKind) as object,
      publishedRevision: 1,
      updatedBy: user.id,
      publishedAt: new Date(),
    },
    update: {},
  })));

  const rows = await prisma.gameContent.findMany({ orderBy: { kind: 'asc' } });
  return NextResponse.json({
    content: rows.map((row) => ({
      kind: row.kind,
      revision: row.revision,
      publishedRevision: row.publishedRevision,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      dirty: row.revision !== row.publishedRevision,
    })),
  });
}
