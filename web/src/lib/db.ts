import { PrismaClient } from '@prisma/client';

/**
 * One PrismaClient per process. Next's dev server re-evaluates modules on every
 * change, so the instance is parked on globalThis to avoid exhausting the
 * connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
