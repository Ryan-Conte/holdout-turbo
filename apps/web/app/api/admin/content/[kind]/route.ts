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
  return NextResponse.json({
    kind: row.kind,
    draft: row.draft,
    published: row.published,
    revision: row.revision,
    publishedRevision: row.publishedRevision,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
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
  const row = await prisma.gameContent.upsert({
    where: { kind: auth.kind },
    create: { kind: auth.kind, draft: draft as object, updatedBy: auth.user.id },
    update: { draft: draft as object, revision: { increment: 1 }, updatedBy: auth.user.id, updatedAt: new Date() },
  });
  return NextResponse.json({ ok: true, revision: row.revision, updatedAt: row.updatedAt });
}

export async function POST(_req: Request, context: Context) {
  const auth = await authorize(context);
  if ('error' in auth) return auth.error;
  const current = await prisma.gameContent.findUnique({ where: { kind: auth.kind } });
  if (!current) return NextResponse.json({ error: 'Save a draft before publishing' }, { status: 409 });
  const published = sanitizeGameContent(auth.kind, current.draft);
  const row = await prisma.gameContent.update({
    where: { kind: auth.kind },
    data: {
      published: published as object,
      publishedRevision: current.revision,
      publishedAt: new Date(),
      updatedBy: auth.user.id,
    },
  });
  return NextResponse.json({ ok: true, publishedRevision: row.publishedRevision, publishedAt: row.publishedAt });
}
