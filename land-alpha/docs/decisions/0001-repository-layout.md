# ADR 0001 — Land Alpha lives in `land-alpha/` inside this repository

- Status: Accepted
- Date: 2026-08-18

## Context

The repository already contains **VentureForge**, an unrelated Python product
(agentic business screener). Land Alpha is a different product with a different
runtime (Node/TypeScript), a different database (PostgreSQL + PostGIS) and a
different deployment target.

## Decision

Land Alpha is built as a self-contained monorepo rooted at `land-alpha/`.
Nothing in the pre-existing VentureForge tree is modified or deleted.

`land-alpha/` owns its own `pnpm-workspace.yaml`, `package.json`, tsconfig,
lint config, tests, Docker Compose and docs. It can be lifted into its own
repository at any time with `git subtree split` and no code changes.

## Consequences

- Two toolchains coexist; CI must scope to the correct directory.
- No accidental coupling between products.
- The extraction path to a dedicated repo stays open and cheap.
