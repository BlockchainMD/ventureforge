import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { prisma } from '../client';
import { STARTER_SAVED_SEARCHES, type UserRole } from '@land-alpha/shared';

/**
 * Development users and their starter saved searches.
 *
 * Password hashing here uses scrypt from the Node standard library, matching
 * the web app's verifier. Development passwords are intentionally obvious and
 * the seed refuses to run against a production database.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = scryptSync(password, salt, 64).toString('hex');
  // Constant-time comparison over fixed-length hex digests.
  const a = createHash('sha256').update(derived).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.equals(b);
}

const SEED_USERS: { email: string; name: string; role: UserRole; password: string }[] = [
  { email: 'admin@landalpha.local', name: 'Alex Admin', role: 'ADMIN', password: 'landalpha-dev' },
  { email: 'analyst@landalpha.local', name: 'Avery Analyst', role: 'ANALYST', password: 'landalpha-dev' },
  { email: 'viewer@landalpha.local', name: 'Val Viewer', role: 'VIEWER', password: 'landalpha-dev' },
];

export async function seedUsers(): Promise<number> {
  let count = 0;
  for (const user of SEED_USERS) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: hashPassword(user.password),
      },
      update: { name: user.name, role: user.role },
      select: { id: true, role: true },
    });
    count += 1;

    if (record.role !== 'VIEWER') {
      for (const search of STARTER_SAVED_SEARCHES) {
        await prisma.savedSearch.upsert({
          where: { userId_name: { userId: record.id, name: search.name } },
          create: {
            userId: record.id,
            name: search.name,
            filters: search.filters as unknown as object,
            isPinned: true,
          },
          update: { filters: search.filters as unknown as object },
        });
      }
      await prisma.watchlist.upsert({
        where: { userId_name: { userId: record.id, name: 'Primary' } },
        create: { userId: record.id, name: 'Primary' },
        update: {},
      });
    }
  }
  return count;
}
