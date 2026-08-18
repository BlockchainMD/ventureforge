# ADR 0007 — AI writes prose, engines produce numbers

- Status: Accepted
- Date: 2026-08-18

## Context

The brief is explicit: AI must never be the sole authority for title status, legal
access, buildability, zoning compliance, environmental condition or valuation.
It may summarise evidence and assign preliminary scores.

That is easy to state and easy to violate accidentally. "Write a compelling
listing for this parcel" reliably produces *buildable*, *road access*, *utilities
available*, *perfect for your dream home* — the exact claims that matter most and
that the data does not support.

## Decision

The dependency runs one way: **deterministic engines produce every number and
every conclusion; AI is given that output and may only explain it.**

Three mechanisms enforce this rather than relying on prompt instructions alone:

1. **Fact sheets, not database access.** Generators receive a rendered fact
   sheet assembled from persisted engine output. There is no path from a model
   response back into a scored field.

2. **Structural validation of responses.** A memo response that ignores the
   required section structure is discarded and the deterministic renderer is
   used instead — unlabelled prose is never presented as a memo. Any section the
   model drops is filled deterministically, so a memo is never silently missing
   its risk analysis.

3. **Claim guardrails on listings.** `GUARDED_CLAIMS` enumerates every assertion
   that requires evidence and what evidence would license it. Unlicensed claims
   are recorded in `withheldClaims` and shown to the analyst. A sentence-level
   filter then drops any model output asserting a forbidden claim; if more than
   30% of the response needs removing, the whole response is discarded, because
   a model needing that much censoring was not writing from the facts.

The `fixture` provider is the default and requires no credentials. Since every
figure already comes from an engine, fixture mode renders the same facts without
the prose — genuinely useful rather than a stub, and it keeps the entire product
runnable and testable with no API key.

## Consequences

- Memos and listings are less fluent without a provider, and exactly as accurate.
- The guardrails are testable, and are tested against a provider that
  deliberately returns non-compliant marketing copy.
- Adding a generator means adding its guardrails, not just its prompt.
