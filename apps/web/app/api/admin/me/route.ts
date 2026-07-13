import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ admin: false }, { status: 403 });
  return NextResponse.json({ admin: true, user: { id: user.id, name: user.name } });
}
