import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Next.js dev-mode HMR re-evaluates modules on every edit; without the global
 * cache each edit leaks a connection pool until Postgres refuses new
 * connections. The global is intentional and standard.
 */

const globalForPrisma = globalThis as unknown as { landAlphaPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.PRISMA_LOG === 'query'
        ? ['query', 'warn', 'error']
        : process.env.NODE_ENV === 'production'
          ? ['warn', 'error']
          : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.landAlphaPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.landAlphaPrisma = prisma;
}

export { Prisma, PrismaClient };
export type { PrismaClient as Db };

/** Narrow a Prisma error to its code without importing the error classes everywhere. */
export function prismaErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return null;
}

export const UNIQUE_VIOLATION = 'P2002';
export const NOT_FOUND = 'P2025';
