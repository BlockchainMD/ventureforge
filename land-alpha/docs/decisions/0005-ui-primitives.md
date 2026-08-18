# ADR 0005 — shadcn/ui primitives are vendored, not CLI-generated

- Status: Accepted
- Date: 2026-08-18

## Context

shadcn/ui is a copy-in component library: the CLI writes Radix + Tailwind +
`class-variance-authority` source files into your project and then gets out of
the way.

## Decision

The primitives Land Alpha needs (`button`, `card`, `badge`, `table`, `input`,
`select`, `tabs`, `dialog`, `tooltip`, `switch`, `checkbox`, `separator`,
`label`, `progress`) are vendored directly under
`apps/web/src/components/ui/`, written in the shadcn idiom against the same
Radix primitives and the same `cn()` helper.

## Rationale

The end state is byte-for-byte the kind of file the CLI produces, but the build
does not depend on an interactive network-bound generator, and the components
are tuned from the start to the terminal-density design language (compact
paddings, tabular numerals, mono numeric columns) rather than the consumer
defaults.

## Consequences

- `npx shadcn add <component>` still works for anything added later.
- The theme lives in one place: `apps/web/src/app/globals.css`.
