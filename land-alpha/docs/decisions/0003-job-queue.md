# ADR 0003 — Queue abstraction with a Postgres default and a BullMQ driver

- Status: Accepted
- Date: 2026-08-18

## Context

The brief asks for Redis + BullMQ. But an MVP must be runnable with
`pnpm dev` and nothing else, and much of Land Alpha's job traffic is
low-frequency, long-running and idempotent (a county inventory refresh runs
daily, not thousands of times a second).

## Decision

Define a small `JobQueue` interface in `@land-alpha/shared` with two drivers:

1. **`postgres` (default).** Jobs are rows in the `Job` table, claimed with
   `SELECT ... FOR UPDATE SKIP LOCKED`. No extra infrastructure, full job
   history in the same transactional store as everything else, and job state is
   queryable from the analyst UI for free.
2. **`bullmq`.** Selected automatically when `REDIS_URL` is set. Gives
   concurrency control, delayed/repeatable jobs and horizontal workers.

`QUEUE_DRIVER` overrides the automatic choice.

## Rationale

`FOR UPDATE SKIP LOCKED` is a well-understood, safe work-claiming pattern and
is entirely adequate at Land Alpha's job rates. Keeping the job log in Postgres
means the "Ingestion" and "Source Health" screens are plain SQL queries rather
than a separate Redis introspection path. Redis remains one env var away for
production scale.

## Consequences

- Local development and CI need only Postgres.
- Both drivers must satisfy the same interface tests.
