# 0010 — Making the product decide, not just describe

Status: accepted · 2026-08-21

## Context

After [ADR 0009](0009-florida-tax-roll-importer.md) the product could value a
parcel from recorded sales. It still could not answer the questions that decide
whether the business makes money:

- *How long will my capital be tied up?* Every parcel assumed 180 days.
- *Was I right last time?* Realised outcomes were stored and never read.
- *Should I sell for cash or carry the note?* Not modelled at all.
- *Which parcels should this specific budget buy?* Not modelled at all.
- *Did the price just drop on something I am watching?* Silent.

Each of these is a place where the product described the world accurately and
then failed to act on the description.

## Decisions

### Hold time is estimated per parcel, and ranking uses annualised return

Return here is annualised, so time to exit is half the answer. Two parcels in
the current inventory had raw returns of 1534% and 1507% — indistinguishable —
and annualised returns of 478% and 1804%, because one takes 581 days to sell and
the other 344. The pipeline preferred the slow one, for having the bigger
margin.

A baseline hold is now adjusted by named factors: size (a one-acre building lot
has the deepest buyer pool; eighty acres and quarter-acre remnants both have
thin ones), price (above roughly $50,000 the buyer needs financing and land
lending is thin), access, buildability, utilities, and market depth from
comparable count. Class A access averages 202 days across current inventory
against 876 for class D — a 4.3× spread the flat assumption erased. 217 of 338
parcel scores changed.

**What this is not.** Roll files record that a sale happened, not how long the
parcel was listed first, so days-on-market cannot be derived from the
comparables we hold. The baseline is an assumption and the factors are
relationships that hold in this asset class, not fitted coefficients. Confidence
is capped at MEDIUM until realised hold times exist.

### Predictions are graded against outcomes

`realizedProfit`, `realizedRoi` and `daysHeld` had been in the schema from the
start and nothing ever read them back. An engine that is 30% optimistic in one
county stays 30% optimistic there forever.

Calibration compares predicted quick-sale value and hold period against realised
sale price and days held, per market, and feeds corrections back into the price
per acre and the hold estimate. Four commitments keep it from doing harm:

1. **Grade the prediction that informed the decision** — the valuation snapshot
   in force at acquisition, not today's. Today's has the benefit of comparables
   recorded after the purchase; grading against it would be marking homework
   with the answers in front of you.
2. **Median, not mean** — five accurate sales and one catastrophe must not
   report a bias that does not exist.
3. **Silence below five closed sales in a market** — a model that corrects
   itself from two data points is more dangerous than one that never corrects,
   because it looks like it is learning.
4. **Bounded 0.5×–2.0×** — one anomalous cluster cannot wreck the model.

Fixture parcels are excluded: calibrating a model against outcomes it generated
is circular.

With no closed deals the report says so plainly rather than emitting factors.

### Seller financing is modelled as an exit, and compared against cash

A $15,000 parcel sold outright returns $15,000. At 10% down over 84 months it
returns about $21,400 nominal and reaches a far wider pool of buyers, but locks
the capital up for seven years. Which is better is not the same answer for every
parcel, so it belongs in the engine.

Amortisation in integer cents with the final payment absorbing rounding drift;
IRR by bisection; the headline is the annualised comparison rather than the
nominal total, because financing nearly always wins on nominal and nearly always
loses on time-to-capital.

The ledger stores payments, not instalments — the schedule is derived, so a note
cannot drift out of agreement with its own arithmetic. One exception: the
schedule is snapshotted at signing, because a note is a contract and a later
improvement to the engine must not restate what a buyer agreed to.

`DEFAULTED` is re-evaluated rather than terminal, because a land contract
normally reinstates on cure.

**This models money, not law.** Seller-financed land generally sits outside the
federal residential-mortgage rules, but that depends on the parcel, the buyer's
intent and the state, and several states regulate land-contract forfeiture
closely. The `DEFAULTED` status says explicitly that it is not authority to
retake a parcel.

### Capital is allocated as a basket, not a ranked list

An investor with $50,000 is not asking which parcel is best. Bounded knapsack on
expected profit per dollar per year, with no county taking more than 40% of the
budget and no parcel more than 25% — a basket of eight parcels in one county is
one bet on one county's market whatever the arithmetic says.

It refuses as readily as it picks, and reports why. Three warnings matter more
than the picks: when the budget is underspent it distinguishes *not enough
qualifying inventory* from *ran out of money*; a single-county basket is named
as one bet; and any pick implying more than 500% a year is flagged as more
likely a valuation error than an opportunity. That last one fires against
current inventory, which is the point — the allocator is the last place a bad
valuation can be caught before someone acts on it.

Nothing here commits money. The brief is explicit that this software must never
autonomously submit a bid.

### Alerts fire on what changed, not on what is new

Alerts only ever notified about parcels new since the last run, and a parcel
already notified could never notify again — so a price cut on a watched parcel
was silent. The schema comment on `ParcelChange` says it outright: a parcel
re-offered three times at a falling price is the strongest signal in this
product. The alerts could not deliver it.

Evaluation now reads the change log and fires on four time-critical events: new
inventory, a price reduction, a parcel returning to a list after failing to
sell, and a sale date moving closer. Deduplication keys on the change rather
than the parcel. A price *increase* is recorded and not alerted; a cut of 25% or
more is immediate. An alert that fires on everything gets muted, and a muted
alert is the same as no alert.

### Coverage is configuration where the format allows it

Florida publishes the same two files for all 67 counties, so a county is one
registry entry. Six central-Florida counties added, three imported to prove it:

| County | Qualified vacant sales | Median $/acre |
|---|---|---|
| Marion (Ocala) | 4,883 | $68,138 |
| Citrus | 3,189 | $58,065 |
| Orange (Orlando) | 655 | $171,410 |
| Grant, MN | 181 | $7,159 |

The gradient is a sanity check in itself: metropolitan Orange is worth three
times rural Marion, which is worth ten times rural Minnesota. That is what real
land markets look like.

The remaining counties are registered but not enabled. Each import pulls a
property roll of tens of megabytes from a public server, and doing that for
counties whose inventory we do not carry would be taking without needing.

Minnesota has no statewide equivalent, so each county must be investigated
individually. Mille Lacs publishes one assessor layer carrying no sale price,
date, qualification or acreage; Crow Wing has no public ArcGIS host; Aitkin and
Itasca were unreachable. All recorded, so the same investigation is not repeated.

## Consequences

- Comparable sales went from 181 to 8,908 across four counties.
- The ranked list now orders on return per year rather than return, which
  changed the majority of scores.
- Every engine that produces a number now has a route by which reality can
  correct it — but that route is empty until deals close, and the calibration
  page says so rather than implying otherwise.
- Geolocating the Florida comparables remains the highest-value follow-up: the
  roll has no coordinates, which caps every Florida valuation at LOW confidence
  no matter how many sales back it.
