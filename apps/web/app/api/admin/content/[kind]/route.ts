import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { defaultGameContent, isEngineContentKind, sanitizeGameContent } from '@/lib/game-content';
import { prisma } from '@/lib/db';

interface Context { params: Promise<{ kind: string }> }

async function authorize(context: Context) {
  const [user, params] = await Promise.all([requireAdmin(), context.params]);
  if (!user) return { error: NextResponse.json({ error: 'Admins only' }, { status: 403 }) };
  if (!isEngineContentKind(params.kind)) {
    return { error: NextResponse.json({ error: 'Unknown content kind' }, { status: 404 }) };
  }
  return { user, kind: params.kind };
}

export async function GET(_req: Request, context: Context) {
  const auth = await authorize(context);
  if ('error' in auth) return auth.error;
  const fallback = defaultGameContent(auth.kind);
  const row = await prisma.gameContent.upsert({
    where: { kind: auth.kind },
    create: {
      kind: auth.kind,
      draft: fallback as object,
      published: fallback as object,
      publishedRevision: 1,
      updatedBy: auth.user.id,
      publishedAt: new Date(),
    },
    update: {},
  });
  await prisma.gameContentRevision.createMany({
    data: [{ kind: auth.kind, revision: row.revision, data: row.draft as object, published: row.publishedRevision === row.revision, createdBy: row.updatedBy }],
    skipDuplicates: true,
  });
  const history = await prisma.gameContentRevision.findMany({
    where: { kind: auth.kind },
    orderBy: { revision: 'desc' },
    take: 30,
    select: { revision: true, published: true, createdBy: true, createdAt: true },
  });
  const needsSanitizedView = auth.kind === 'settings' || auth.kind === 'resources';
  const draft = needsSanitizedView ? sanitizeGameContent(auth.kind, row.draft ?? fallback) : row.draft;
  const published = needsSanitizedView ? sanitizeGameContent(auth.kind, row.published ?? fallback) : row.published;
  return NextResponse.json({
    kind: row.kind,
    draft,
    published,
    revision: row.revision,
    publishedRevision: row.publishedRevision,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    history,
  });
}

export async function PUT(req: Request, context: Context) {
  const auth = await authorize(context);
  if ('error' in auth) return auth.error;
  let body: { draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  let draft: unknown;
  try {
    draft = sanitizeGameContent(auth.kind, body.draft);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.gameContent.upsert({
      where: { kind: auth.kind },
      create: { kind: auth.kind, draft: draft as object, updatedBy: auth.user.id },
      update: { draft: draft as object, revision: { increment: 1 }, updatedBy: auth.user.id, updatedAt: new Date() },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: auth.kind, revision: saved.revision } },
      create: { kind: auth.kind, revision: saved.revision, data: draft as object, createdBy: auth.user.id },
      update: { data: draft as object, createdBy: auth.user.id },
    });
    return saved;
  });
  return NextResponse.json({ ok: true, revision: row.revision, publishedRevision: row.publishedRevision, updatedAt: row.updatedAt });
}

export async function POST(_req: Request, context: Context) {
  const auth = await authorize(context);
  if ('error' in auth) return auth.error;
  const current = await prisma.gameContent.findUnique({ where: { kind: auth.kind } });
  if (!current) return NextResponse.json({ error: 'Save a draft before publishing' }, { status: 409 });
  const published = sanitizeGameContent(auth.kind, current.draft);
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.gameContent.update({
      where: { kind: auth.kind },
      data: {
        published: published as object,
        publishedRevision: current.revision,
        publishedAt: new Date(),
        updatedBy: auth.user.id,
      },
    });
    await tx.gameContentRevision.upsert({
      where: { kind_revision: { kind: auth.kind, revision: current.revision } },
      create: { kind: auth.kind, revision: current.revision, data: published as object, published: true, createdBy: auth.user.id },
      update: { data: published as object, published: true },
    });
    return saved;
  });
  return NextResponse.json({ ok: true, publishedRevision: row.publishedRevision, publishedAt: row.publishedAt });
}

export async function PATCH(req: Request, context: Context) {
  const auth = await authorize(context);
  if ('error' in auth) return auth.error;
  let body: { revision?: number; publish?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const requested = Math.floor(Number(body.revision));
  if (!Number.isFinite(requested) || requested <= 0) return NextResponse.json({ error: 'Choose a revision to restore' }, { status: 400 });
  const [snapshot, current] = await Promise.all([
    prisma.gameContentRevision.findUnique({ where: { kind_revision: { kind: auth.kind, revision: requested } } }),
    prisma.gameContent.findUnique({ where: { kind: auth.kind } }),
  ]);
  if (!snapshot || !current) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  const restored = sanitizeGameContent(auth.kind, snapshot.data);
  const nextRevision = current.revision + 1;
  const publish = body.publish !== false;
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.gameContent.update({
      where: { kind: auth.kind },
      data: {
        draft: restored as object,
        revision: nextRevision,
        ...(publish ? { published: restored as object, publishedRevision: nextRevision, publishedAt: new Date() } : {}),
        updatedBy: auth.user.id,
        updatedAt: new Date(),
      },
    });
    await tx.gameContentRevision.create({
      data: { kind: auth.kind, revision: nextRevision, data: restored as object, published: publish, createdBy: auth.user.id },
    });
    return saved;
  });
  return NextResponse.json({ ok: true, revision: row.revision, publishedRevision: row.publishedRevision, restoredFrom: requested });
}
