import { PrismaClient } from '@prisma/client';

// singleton across Next.js hot reloads
const g = globalThis as unknown as { __holdoutPrisma?: PrismaClient };

export const prisma: PrismaClient = g.__holdoutPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.__holdoutPrisma = prisma;
