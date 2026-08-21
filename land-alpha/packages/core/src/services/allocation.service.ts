import { prisma, toCents } from '@land-alpha/db';
import {
  allocateCapital,
  DEFAULT_ALLOCATION_CONFIG,
  type AllocationCandidate,
  type AllocationConfig,
  type AllocationPlan,
} from '@land-alpha/valuation';

/**
 * Turn the ranked list into a buy plan for a given amount of money.
 *
 * Only live, unrejected inventory is considered — a plan that proposes buying a
 * parcel the screening rules threw out would be worse than no plan.
 */

export async function planAllocation(
  options: { budgetCents: number } & Partial<Omit<AllocationConfig, 'budgetCents'>>,
): Promise<AllocationPlan> {
  const rows = await prisma.parcelOpportunity.findMany({
    where: {
      rejected: false,
      analystDisposition: { not: 'PASS' },
      // Anything already bought, sold or shelved is not available to buy.
      status: {
        notIn: [
          'REJECTED',
          'PURCHASE_PENDING',
          'ACQUIRED',
          'TITLE_CURATIVE',
          'READY_TO_LIST',
          'LISTED',
          'UNDER_CONTRACT',
          'SOLD',
          'ARCHIVED',
        ],
      },
      quickSaleValue: { not: null },
    },
    select: {
      id: true,
      apn: true,
      state: true,
      county: true,
      estimatedAllInBasis: true,
      askingPrice: true,
      minimumBid: true,
      quickSaleValue: true,
      expectedHoldDays: true,
      alphaScore: true,
      valuationConfidence: true,
    },
    orderBy: { alphaScore: 'desc' },
    take: 500,
  });

  const candidates: AllocationCandidate[] = rows.map((row) => ({
    parcelId: row.id,
    apn: row.apn,
    state: row.state,
    county: row.county,
    // Fall back to the published price when the full basis has not been
    // modelled: understating cost would overstate return, so prefer the
    // modelled basis where it exists.
    allInBasisCents:
      toCents(row.estimatedAllInBasis) ?? toCents(row.askingPrice) ?? toCents(row.minimumBid) ?? 0,
    quickSaleValueCents: toCents(row.quickSaleValue),
    expectedHoldDays: row.expectedHoldDays,
    alphaScore: row.alphaScore,
    valuationConfidence: row.valuationConfidence,
  }));

  return allocateCapital(candidates, {
    ...DEFAULT_ALLOCATION_CONFIG,
    ...options,
  });
}
