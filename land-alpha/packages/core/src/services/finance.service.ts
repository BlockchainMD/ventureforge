import { createLogger } from '@land-alpha/shared/logger';
import { prisma, toCents, toDecimal, Prisma } from '@land-alpha/db';
import {
  buildAmortizationSchedule,
  compareCashVsFinanced,
  suggestTerms,
  type AmortizationSchedule,
  type FinanceComparison,
  type FinanceTerms,
} from '@land-alpha/valuation';

/**
 * Seller-financed notes: what was agreed, what has been paid, where it stands.
 *
 * The schedule is derived from the terms rather than stored instalment by
 * instalment, so a note can never disagree with its own arithmetic. What is
 * stored is what actually happened — the payments — and everything else is
 * computed from the two.
 *
 * One exception: the schedule is snapshotted at signing. A note is a contract,
 * and a later improvement to the amortisation engine must not silently restate
 * what a buyer agreed to.
 */

const logger = createLogger({ component: 'finance-service' });

export interface NoteStanding {
  readonly noteId: string;
  readonly status: string;
  readonly principalBalanceCents: number;
  readonly paidToDateCents: number;
  readonly scheduledToDateCents: number;
  /** Positive when the buyer is behind. */
  readonly arrearsCents: number;
  readonly paymentsMade: number;
  readonly paymentsScheduled: number;
  readonly daysPastDue: number;
  readonly nextDueDate: Date | null;
  readonly nextPaymentCents: number | null;
  readonly warnings: string[];
}

function termsOf(note: {
  salePrice: Prisma.Decimal;
  downPayment: Prisma.Decimal;
  annualRate: number;
  termMonths: number;
  documentFee: Prisma.Decimal;
  monthlyFee: Prisma.Decimal;
}): FinanceTerms {
  return {
    salePriceCents: toCents(note.salePrice) ?? 0,
    downPaymentCents: toCents(note.downPayment) ?? 0,
    annualRate: note.annualRate,
    termMonths: note.termMonths,
    documentFeeCents: toCents(note.documentFee) ?? 0,
    monthlyFeeCents: toCents(note.monthlyFee) ?? 0,
  };
}

/** What financing this parcel would look like, before anything is committed. */
export async function previewFinancing(
  parcelId: string,
  overrides: Partial<FinanceTerms> = {},
): Promise<{
  terms: FinanceTerms;
  schedule: AmortizationSchedule;
  comparison: FinanceComparison;
} | null> {
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    select: {
      quickSaleValue: true,
      retailValue: true,
      estimatedAllInBasis: true,
      expectedHoldDays: true,
    },
  });
  if (!parcel) return null;

  // Financing is priced off retail, not quick sale: a buyer paying monthly is
  // not the buyer who needs a discount to move today.
  const listPrice = toCents(parcel.retailValue) ?? toCents(parcel.quickSaleValue);
  if (listPrice == null || listPrice <= 0) return null;

  const terms = { ...suggestTerms(listPrice), ...overrides };
  const firstPayment = new Date();
  firstPayment.setUTCMonth(firstPayment.getUTCMonth() + 1);
  const schedule = buildAmortizationSchedule(terms, firstPayment);

  const comparison = compareCashVsFinanced({
    allInBasisCents: toCents(parcel.estimatedAllInBasis) ?? 0,
    cashSalePriceCents: toCents(parcel.quickSaleValue) ?? listPrice,
    cashHoldDays: parcel.expectedHoldDays ?? 180,
    terms,
    schedule,
  });

  return { terms, schedule, comparison };
}

export async function createNote(input: {
  parcelId: string;
  terms: FinanceTerms;
  firstPaymentDate: Date;
  buyerLeadId?: string | null;
  lateFeeCents?: number;
  graceDays?: number;
}): Promise<string> {
  const schedule = buildAmortizationSchedule(input.terms, input.firstPaymentDate);

  const note = await prisma.financeNote.create({
    data: {
      parcelId: input.parcelId,
      buyerLeadId: input.buyerLeadId ?? null,
      status: 'DRAFT',
      salePrice: toDecimal(input.terms.salePriceCents)!,
      downPayment: toDecimal(input.terms.downPaymentCents)!,
      annualRate: input.terms.annualRate,
      termMonths: input.terms.termMonths,
      documentFee: toDecimal(input.terms.documentFeeCents ?? 0)!,
      monthlyFee: toDecimal(input.terms.monthlyFeeCents ?? 0)!,
      lateFee: toDecimal(input.lateFeeCents ?? 2_500)!,
      graceDays: input.graceDays ?? 10,
      firstPaymentDate: input.firstPaymentDate,
      scheduleSnapshot: schedule as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  logger.info('finance note created', {
    noteId: note.id,
    parcelId: input.parcelId,
    financed: schedule.financedCents,
    months: input.terms.termMonths,
  });
  return note.id;
}

export async function recordPayment(input: {
  noteId: string;
  amountCents: number;
  receivedAt: Date;
  kind?:
    | 'DOWN_PAYMENT'
    | 'SCHEDULED'
    | 'EXTRA_PRINCIPAL'
    | 'PAYOFF'
    | 'LATE_FEE'
    | 'DOCUMENT_FEE'
    | 'REFUND';
  method?: string | null;
  reference?: string | null;
  recordedById?: string | null;
  /** Evaluate standing as of this moment rather than now. */
  asOf?: Date;
}): Promise<NoteStanding> {
  await prisma.financePayment.create({
    data: {
      noteId: input.noteId,
      kind: input.kind ?? 'SCHEDULED',
      amount: toDecimal(input.amountCents)!,
      receivedAt: input.receivedAt,
      method: input.method ?? null,
      reference: input.reference ?? null,
      recordedById: input.recordedById ?? null,
    },
  });
  return refreshNoteStanding(input.noteId, input.asOf);
}

/**
 * Where the note stands, and whether that changes its status.
 *
 * Delinquency is measured against the schedule rather than against the last
 * payment date: a buyer who pays half of each instalment on time is behind,
 * and a rule that only looked at dates would not notice.
 */
export async function refreshNoteStanding(
  noteId: string,
  asOf: Date = new Date(),
): Promise<NoteStanding> {
  const note = await prisma.financeNote.findUnique({
    where: { id: noteId },
    include: { payments: true },
  });
  if (!note) throw new Error(`Finance note not found: ${noteId}`);

  const schedule = buildAmortizationSchedule(termsOf(note), note.firstPaymentDate);
  const warnings: string[] = [];

  // Down payments, document fees and refunds are not instalments and must not
  // be credited against the amortising balance.
  const creditKinds = new Set(['SCHEDULED', 'EXTRA_PRINCIPAL', 'PAYOFF']);
  const credited = note.payments.filter((payment) => creditKinds.has(payment.kind));
  const paidToDate = credited.reduce((sum, payment) => sum + (toCents(payment.amount) ?? 0), 0);

  const due = schedule.payments.filter((payment) => payment.dueDate <= asOf);
  const scheduledToDate = due.reduce((sum, payment) => sum + payment.paymentCents, 0);
  const arrears = Math.max(0, scheduledToDate - paidToDate);

  // Principal outstanding: what was financed, less the principal portion of
  // every instalment the payments have actually covered.
  let remaining = paidToDate;
  let principalRepaid = 0;
  let instalmentsCovered = 0;
  for (const payment of schedule.payments) {
    if (remaining >= payment.paymentCents) {
      remaining -= payment.paymentCents;
      principalRepaid += payment.principalCents;
      instalmentsCovered += 1;
    } else {
      // A partial payment is applied to fees and interest first, as a note
      // normally provides, so it reduces principal only once those are met.
      const towardPrincipal = Math.max(0, remaining - payment.feeCents - payment.interestCents);
      principalRepaid += Math.min(payment.principalCents, towardPrincipal);
      break;
    }
  }
  const principalBalance = Math.max(0, schedule.financedCents - principalRepaid);

  const firstUnpaid = schedule.payments[instalmentsCovered] ?? null;
  const daysPastDue =
    arrears > 0 && firstUnpaid && firstUnpaid.dueDate <= asOf
      ? Math.floor((asOf.getTime() - firstUnpaid.dueDate.getTime()) / 86_400_000)
      : 0;

  let status = note.status;
  // DEFAULTED is re-evaluated rather than terminal: a buyer who catches up has
  // cured the default, and a land contract normally reinstates on cure. Only
  // an outcome someone acted on — forfeiture, cancellation, payoff — sticks.
  const liveStatuses = new Set(['ACTIVE', 'DELINQUENT', 'DEFAULTED']);
  if (liveStatuses.has(note.status)) {
    if (principalBalance === 0) {
      status = 'PAID_OFF';
    } else if (daysPastDue > 90) {
      status = 'DEFAULTED';
      warnings.push(
        `More than 90 days past due. Forfeiture is a legal process that varies by state and needs professional handling — do not treat this status as authority to retake the parcel.`,
      );
    } else if (daysPastDue > note.graceDays) {
      status = 'DELINQUENT';
      warnings.push(`${daysPastDue} days past due, beyond the ${note.graceDays}-day grace period.`);
    } else {
      status = 'ACTIVE';
    }
  }

  if (status !== note.status) {
    await prisma.financeNote.update({
      where: { id: noteId },
      data: {
        status,
        closedAt: status === 'PAID_OFF' ? asOf : note.closedAt,
        closureReason: status === 'PAID_OFF' ? 'Paid in full' : note.closureReason,
      },
    });
    logger.info('finance note status changed', { noteId, from: note.status, to: status });
  }

  return {
    noteId,
    status,
    principalBalanceCents: principalBalance,
    paidToDateCents: paidToDate,
    scheduledToDateCents: scheduledToDate,
    arrearsCents: arrears,
    paymentsMade: instalmentsCovered,
    paymentsScheduled: schedule.payments.length,
    daysPastDue,
    nextDueDate: firstUnpaid?.dueDate ?? null,
    nextPaymentCents: firstUnpaid?.paymentCents ?? null,
    warnings,
  };
}

/** Sweep every live note, so delinquency surfaces without anyone asking. */
export async function refreshAllNotes(asOf = new Date()): Promise<NoteStanding[]> {
  const notes = await prisma.financeNote.findMany({
    where: { status: { in: ['ACTIVE', 'DELINQUENT'] } },
    select: { id: true },
  });
  const standings: NoteStanding[] = [];
  for (const note of notes) standings.push(await refreshNoteStanding(note.id, asOf));
  return standings;
}
