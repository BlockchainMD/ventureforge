# 17. A passed sale date is not a verdict, and a missing step is not a missing fact

Date: 2026-08-22

## Status

Accepted.

## Context

Two defects found on the same afternoon turned out to be the same mistake seen
from opposite sides.

**A county with no geocoded comparables.** Marion sat at 0% located for a whole
working session. Every Florida valuation came back LOW, which was correct — a
sale that cannot be placed cannot be checked for proximity — but the confidence
level was the only symptom anywhere in the product. The cause was a skipped
import step, and nothing said so.

**Eight parcels whose auction had already happened.** Orange County parcels with
an auction date of 20 August were still ranked, unrejected and presented as
buyable on the 22nd. The deadline column showed a bare date. Sorted by deadline
ascending, the parcels furthest past their auction sorted *above* every parcel
still open for bidding.

In both cases the product reported a consequence where a diagnosis was
available, which is ADR 0013's dark-list defect. But the two demand opposite
remedies, and getting that backwards would have been worse than either bug.

## Decision

**Where the cause is ours, name it and name the fix.**

A Florida county at 0% geocoded is a step the operator did not run. The system
knows this with certainty — the pass exists, it is skippable, and the evidence
that it was skipped is in the database. So `classifyCoverage` says exactly that,
and names the command.

**Where the cause is the world's, report the state and ask, do not conclude.**

A passed auction date says the date passed. It does not say the parcel sold. It
may have gone unsold and moved to a lands-available list — which in Florida is
precisely how the best inventory appears, and how both of Marion's priced
parcels reached us. Writing `saleStatus = 'EXPIRED'` from a clock would be the
system inventing a fact about the world that only the county can settle.

So `SALE_STATUSES.EXPIRED` stays unwritten by automation. What ships instead is
a worklist: the row is marked stale wherever a deadline renders, counted on the
dashboard, and filterable — and nothing mutates. Re-confirmation comes from the
source.

**The test for which case you are in:** could the system be wrong about the
cause? A skipped geocode pass is checkable from data we hold. What happened at
an auction is not. Where it is checkable, diagnose. Where it is not, describe
the state and route it to a human.

## Per-state, or the diagnosis is a lie

Florida comparables get coordinates from a second pass. Michigan and Minnesota
sales arrive already located, so a county at 0% there is a limit of the
publisher, not a missed step.

Telling a Minnesota operator to run `pnpm comps --geocode-fl` would send them
looking for a step that was never skipped, and would cost more trust than
silence. `GEOCODE_PASS_BY_STATE` gates the instruction on a pass actually
existing, and a test asserts both directions.

## A count must agree with the list it links to

The dashboard's "Sale date passed" metric links to a filtered list. The first
implementation computed the two separately — the metric on `< now`, the link on
`auctionBefore` at midnight, and the link ignored the offer-deadline case
entirely. The comment above it claimed they matched.

That is the source panel's contradiction again: *"3 of 4 enabled sources
healthy"* directly above *"3 sources need attention"*. Both now build from one
`buildWhere({ deadlinePassed: true })`, and an integration spec asserts the count
equals the list's total. Two copies of a condition drift; one definition cannot.

## Consequences

- `EXPIRED` remains in `SALE_STATUSES` and remains unwritten by automation. An
  adapter may set it when a source says so. A clock may not.
- The deadline vocabulary lives in one place. `alert.service` had a private
  `soonestDeadline` with its own rounding; it now delegates, so the alert's
  "Sale date has passed" and the table's "passed 2d ago" cannot disagree.
- Coverage reporting makes a previously silent failure loud, but only for
  states where the fix is real.
- Neither feature deletes or rejects anything. Both surface work.
