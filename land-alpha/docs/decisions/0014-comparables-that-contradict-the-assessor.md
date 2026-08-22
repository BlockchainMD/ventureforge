# 14. Comparables that contradict the assessor do not get to price the parcel

Date: 2026-08-22

## Status

Accepted.

## Context

The engine cross-checks every comparable-sales valuation against the county's
own assessed land value. Where the two disagree by an order of magnitude it
raised a warning and capped valuation confidence at UNKNOWN, on the reasoning
that we cannot tell which of the two numbers is wrong and should not pretend to.

That reasoning was right and the remedy was not, because a confidence level is
a label and nothing in the product ranks on labels:

- the blocked worklist orders by quick-sale value,
- the recommended maximum bid is solved from quick-sale value,
- the capital allocator sizes a position against it,
- and `strandedCents` counts it as value waiting to be unlocked.

So the top-ranked parcel in the whole product was a half-acre in Orange County
assessed by the county at $65,000 and valued here at $821,408 — 12.6× — carrying
a confidence of UNKNOWN that changed nothing about its position at the head of
the list. An operator working the queue in order would have called about that
parcel first.

The comparables behind it were drawn from up to 12 km away in a county that
spans downtown Orlando and open farmland, with adjusted prices per acre ranging
from $87,000 to $4.7 million. They are real sales. They are not sales of this.

## Decision

At the severe threshold the comparables are discarded, not merely doubted, and
the valuation falls back to the assessor's land value times the jurisdiction's
multiplier.

Below that threshold nothing changes: a 2× gap is the median across Orange
County and is exactly the lag a vacant-land assessment is expected to carry, so
the comparables continue to govern and the warning continues to be advisory.

The two thresholds stay in configuration (`assessedDisagreementWarn` at 4×,
`assessedDisagreementSevere` at 10×) rather than in code.

## Consequences

The assessor's number is a poor valuation. It lags, it is negotiated, and on
vacant land it is frequently stale by years. It is nevertheless a poor valuation
*of this parcel*, which is worth more than a good valuation of somewhere else.
The fallback is labelled as such, carries LOW confidence, and its warning says
plainly that it is a floor and a placeholder rather than a market view.

Five of the 244 parcels with both a comparable-sales valuation and an
assessment cross the severe threshold. One of them was ranked first.

The obvious alternative — publishing no value at all — was rejected because a
parcel with no value is dropped from the ranked list, from the worklist, and
from the maximum-bid calculation, which loses the parcel rather than pricing it
conservatively. A parcel we can only value badly is still a parcel a person can
be asked to value properly.

This does not make the assessor an authority on value. It makes the assessor the
tie-breaker on *location*, which is the question the disagreement actually
raises.
