import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { headers } from 'next/headers';
import { prisma } from './db';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
});

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/** Admins live in the DB (profiles.admin). ADMIN_EMAILS env only bootstraps the flag. */
export async function isAdminUser(userId: string, email?: string | null): Promise<boolean> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { admin: true } });
  if (profile?.admin) return true;
  if (isAdminEmail(email)) {
    // first login of a bootstrap admin — persist the flag so the env can go away
    await prisma.profile.upsert({
      where: { userId },
      create: { userId, data: { inv: { backpack: 0, slots: [] } }, admin: true },
      update: { admin: true },
    });
    return true;
  }
  return false;
}

/** Session + DB admin check for admin API routes. Returns the user or null. */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return (await isAdminUser(session.user.id, session.user.email)) ? session.user : null;
}
