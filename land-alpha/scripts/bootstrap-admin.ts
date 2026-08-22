/**
 * Bring a fresh production database up to a usable state.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... pnpm bootstrap:admin
 *
 * This is the production counterpart to `pnpm db:seed`. The seed exists to make
 * a *development* database interesting: it creates three demo accounts whose
 * password is a literal in the repository, plus fixture parcels. Neither belongs
 * on an internet-reachable deployment, and the seed refuses to run there for
 * exactly that reason.
 *
 * What a real deployment actually needs is much smaller:
 *
 *   1. one administrator, with a password the operator chose;
 *   2. an active scoring configuration, or nothing can be ranked;
 *   3. the source registry, or there is nothing to ingest from.
 *
 * No parcels. Those come from ingestion, which is the point of the product.
 *
 * Safe to re-run: every write is an upsert, and re-running with a new
 * ADMIN_PASSWORD is the supported way to rotate it.
 */
import { prisma } from '@land-alpha/db';
import { hashPassword, verifyPassword } from '@land-alpha/db/seed/users';
import { syncRegistry } from '@land-alpha/db/seed/sources';
import {
  DEFAULT_COST_MODEL,
  DEFAULT_REJECTION_RULES,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  STARTER_SAVED_SEARCHES,
} from '@land-alpha/shared';

/**
 * The development password, spelled out here so the guard below can recognise
 * it. It is already public — it is a literal in `packages/db/src/seed/users.ts`
 * in a repository anyone can read — so naming it costs nothing and lets this
 * script refuse to hand an attacker an administrator account.
 */
const KNOWN_DEV_PASSWORD = 'landalpha-dev';

const MIN_PASSWORD_LENGTH = 16;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required.\n` +
        '  This script provisions the administrator for a real deployment, so it ' +
        'will not invent a credential for you.\n' +
        "  Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"",
    );
  }
  return value;
}

/**
 * Fail the deploy if any account still carries the development password.
 *
 * This is deliberately a hard failure rather than a cleanup. Deleting a user
 * cascades into their saved searches, watchlists and deal-room membership, and
 * this script has no way to know whether a given account is a leftover demo
 * login or something an operator created. Refusing is recoverable; guessing is
 * not.
 */
async function assertNoDevPasswords(): Promise<void> {
  const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
  const compromised = users
    .filter((user) => verifyPassword(KNOWN_DEV_PASSWORD, user.passwordHash))
    .map((user) => user.email);

  if (compromised.length > 0) {
    throw new Error(
      `Refusing to bootstrap: ${compromised.length} account(s) still use the development password ` +
        'that is published in this repository.\n' +
        compromised.map((email) => `    - ${email}`).join('\n') +
        '\n  Anyone who can read the source can sign in as these users. Change or remove them ' +
        'before exposing this deployment.',
    );
  }
}

async function main(): Promise<void> {
  const email = required('ADMIN_EMAIL').toLowerCase();
  const password = required('ADMIN_PASSWORD');
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}).`,
    );
  }
  if (password === KNOWN_DEV_PASSWORD) {
    throw new Error(
      'ADMIN_PASSWORD is the development password from the seed, which is public in this repository.',
    );
  }

  console.log('\n─── Bootstrap ──────────────────────────────────');

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, role: 'ADMIN', passwordHash: hashPassword(password) },
    // A re-run rotates the password. That is the whole recovery story for a
    // lost administrator credential, so it must not be silently skipped.
    update: { name, role: 'ADMIN', passwordHash: hashPassword(password) },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  const created = user.createdAt.getTime() === user.updatedAt.getTime();
  console.log(`  administrator       ${email} (${created ? 'created' : 'password rotated'})`);

  for (const search of STARTER_SAVED_SEARCHES) {
    await prisma.savedSearch.upsert({
      where: { userId_name: { userId: user.id, name: search.name } },
      create: {
        userId: user.id,
        name: search.name,
        filters: search.filters as unknown as object,
        isPinned: true,
      },
      update: {},
    });
  }
  await prisma.watchlist.upsert({
    where: { userId_name: { userId: user.id, name: 'Primary' } },
    create: { userId: user.id, name: 'Primary' },
    update: {},
  });

  const existingConfig = await prisma.scoringConfig.findFirst({ where: { isActive: true } });
  if (existingConfig) {
    console.log(`  scoring config      ${existingConfig.version} (already active)`);
  } else {
    await prisma.scoringConfig.create({
      data: {
        version: 'v1',
        isActive: true,
        weights: DEFAULT_WEIGHTS as unknown as object,
        thresholds: DEFAULT_THRESHOLDS as unknown as object,
        costModel: DEFAULT_COST_MODEL as unknown as object,
        rejectionRules: DEFAULT_REJECTION_RULES as unknown as object,
        description: 'Initial weights from the product specification.',
      },
    });
    console.log('  scoring config      v1 (active)');
  }

  const registry = await syncRegistry();
  console.log(`  sources             ${registry.created} created, ${registry.updated} updated`);

  // Last, so that a compromised account fails the deploy even when it was
  // created by an earlier run of the seed against this same database.
  await assertNoDevPasswords();

  console.log('\n  No parcels were created. Run ingestion to populate inventory.\n');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
