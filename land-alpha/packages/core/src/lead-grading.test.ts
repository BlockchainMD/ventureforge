import { describe, expect, it } from 'vitest';
import { gradeLead } from './services/lead.service';

/**
 * "Someone asked a question" and "someone offered money" must not arrive
 * looking the same. An alert queue where everything is urgent gets ignored,
 * and an ignored queue is the same as no queue.
 */

const lead = (overrides: Partial<Parameters<typeof gradeLead>[0]> = {}) =>
  gradeLead({
    name: 'Sam Buyer',
    offerAmountCents: null,
    financing: null,
    inquiry: null,
    askingPriceCents: 2_000_000, // $20,000
    acreage: 5.23,
    county: 'Marion',
    state: 'FL',
    ...overrides,
  });

describe('gradeLead', () => {
  it('treats a full-price offer as the strongest signal a listing can produce', () => {
    const signal = lead({ offerAmountCents: 2_000_000 });
    expect(signal.urgency).toBe('IMMEDIATE');
    expect(signal.title).toContain('Offer $20,000');
    expect(signal.body).toContain('at or above');
  });

  it('treats a near-miss offer as immediate too, because it is negotiable', () => {
    expect(lead({ offerAmountCents: 1_800_000 }).urgency).toBe('IMMEDIATE');
  });

  it('drops a lowball to high rather than immediate', () => {
    const signal = lead({ offerAmountCents: 900_000 });
    expect(signal.urgency).toBe('HIGH');
    expect(signal.body).toContain('against $20,000 asking');
  });

  it('raises a financing enquiry above a general question', () => {
    // These buyers are scarcer than cash buyers and worth more over the life
    // of a note, so they should not sit behind "is there power nearby".
    expect(lead({ financing: 'Interested in monthly payments' }).urgency).toBe('HIGH');
    expect(lead({ inquiry: 'Do you offer owner financing?' }).urgency).toBe('HIGH');
    expect(lead({ inquiry: 'What are the terms?' }).urgency).toBe('HIGH');
  });

  it('leaves a general question at normal', () => {
    const signal = lead({ inquiry: 'Is there power nearby?' });
    expect(signal.urgency).toBe('NORMAL');
    expect(signal.title).toContain('Enquiry');
    expect(signal.body).toContain('Is there power nearby?');
  });

  it('names the county in the title, because that is how an analyst scans', () => {
    expect(lead().title).toContain('Marion County, FL');
  });

  it('copes with an offer on a listing that has no published price', () => {
    const signal = lead({ askingPriceCents: null, offerAmountCents: 1_500_000 });
    expect(signal.urgency).toBe('HIGH');
    expect(signal.title).toContain('$15,000');
  });

  it('truncates a long message rather than flooding the queue', () => {
    const signal = lead({ inquiry: 'x'.repeat(400) });
    expect(signal.body.length).toBeLessThan(200);
  });
});
