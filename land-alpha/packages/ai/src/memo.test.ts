import { describe, expect, it } from 'vitest';
import { permittedAmounts, unsourcedAmounts } from './memo';

/**
 * The system prompt forbids the model from introducing a figure that is not in
 * its input. A prompt is a request; these are the check.
 *
 * A memo is the document a person risks money on, so the cost of a wrong dollar
 * figure is not a bad sentence — it is a bad acquisition.
 */
describe('memo figure verification', () => {
  const sheet = `
    Acquisition price: $24,843.16 [acquisitionPrice]
    Quick-sale value: $20,432.00 [quickSaleValue]
    Recommended maximum bid: $5,098 [maxBid]
  `;
  const permitted = permittedAmounts(sheet);

  it('passes figures the fact sheet actually contains', () => {
    expect(unsourcedAmounts('Basis of $24,843.16 against $20,432.00.', permitted)).toEqual([]);
  });

  it('tolerates a model rounding to the nearest dollar', () => {
    // "$24,843" for "$24,843.16" is a formatting choice, not an invention.
    expect(unsourcedAmounts('Priced at $24,843.', permitted)).toEqual([]);
  });

  it('catches a figure that appears nowhere in the input', () => {
    // The dangerous case: plausible, precise, and wrong.
    expect(unsourcedAmounts('Quick-sale value is $45,000.', permitted)).toEqual(['$45,000']);
  });

  it('catches a transposed digit in an otherwise real figure', () => {
    expect(unsourcedAmounts('Acquisition price: $24,483.16', permitted)).toEqual(['$24,483.16']);
  });

  it('reports every offender, not just the first', () => {
    const offenders = unsourcedAmounts('Between $1,000 and $2,000.', permitted);
    expect(offenders).toEqual(['$1,000', '$2,000']);
  });

  it('reads amounts written with a space after the sign', () => {
    expect(permittedAmounts('Bid: $ 5,098').has(509_800)).toBe(true);
  });
});
