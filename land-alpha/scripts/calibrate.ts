/**
 * Check predictions against outcomes.
 *
 *   pnpm calibrate            report only
 *   pnpm calibrate --apply    write the corrections into a new scoring config
 */
import { prisma } from '@land-alpha/db';
import { runCalibration } from '@land-alpha/core';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const report = await runCalibration({ apply });

  console.log('\n─── Calibration ────────────────────────────────');
  console.log(`  closed sales examined  ${report.generatedFrom}`);
  console.log(`  confidence             ${report.confidence}`);
  if (report.overall.valueRatio != null) {
    const pct = ((report.overall.valueRatio - 1) * 100).toFixed(0);
    console.log(`  realised vs predicted  ${report.overall.valueRatio.toFixed(2)}× (${pct}%)`);
  }
  if (report.overall.holdRatio != null) {
    console.log(`  hold vs estimated      ${report.overall.holdRatio.toFixed(2)}×`);
  }

  if (report.groups.length > 0) {
    console.log('\n  By market:');
    for (const group of report.groups) {
      console.log(`   ${group.applied ? '✓' : '·'} ${group.note}`);
    }
  }
  for (const warning of report.warnings) console.log(`\n  ! ${warning}`);

  if (apply) {
    const markets = Object.keys(report.valueCalibration);
    console.log(
      markets.length > 0
        ? `\n  Applied corrections for: ${markets.join(', ')}`
        : '\n  Nothing applied — no market has enough evidence yet.',
    );
  } else if (Object.keys(report.valueCalibration).length > 0) {
    console.log('\n  Re-run with --apply to write these into the scoring config.');
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
