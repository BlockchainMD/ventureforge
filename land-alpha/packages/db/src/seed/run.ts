import { prisma } from '../client.js';
import {
  DEFAULT_COST_MODEL,
  DEFAULT_REJECTION_RULES,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
} from '@land-alpha/shared';
import { seedUsers } from './users.js';
import { seedComparables } from './comparables.js';
import { seedFixtureParcels } from './parcels.js';

/**
 * Seed the development database.
 *
 *   pnpm db:seed              users, scoring config, comps, fixture parcels
 *   pnpm db:seed --minimal    users and scoring config only
 *
 * Refuses to run against production. Everything it writes is idempotent, so it
 * is safe to re-run after a schema change.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PRODUCTION_SEED) {
    throw new Error(
      'Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=1 if this is genuinely intended.',
    );
  }

  const minimal = process.argv.includes('--minimal');

  const users = await seedUsers();
  console.log(`  users               ${users}`);

  const existingConfig = await prisma.scoringConfig.findFirst({ where: { isActive: true } });
  if (!existingConfig) {
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
  } else {
    console.log(`  scoring config      ${existingConfig.version} (already active)`);
  }

  if (minimal) return;

  const comps = await seedComparables();
  console.log(`  comparable sales    ${comps}`);

  const parcels = await seedFixtureParcels();
  console.log(`  fixture parcels     ${parcels.created} created, ${parcels.updated} updated`);
}

main()
  .then(() => console.log('\nSeed complete.\n'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
