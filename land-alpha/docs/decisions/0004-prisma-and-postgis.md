# ADR 0004 — Prisma for entities, raw PostGIS SQL for geometry

- Status: Accepted
- Date: 2026-08-18

## Context

Prisma has no native PostGIS support. Geometry columns can only be declared as
`Unsupported("geometry(...)")`, which Prisma Client cannot read or write
through the generated API.

## Decision

Keep Prisma (per the brief) for all scalar/relational entity work — it gives us
migrations, a typed client, and a readable schema that doubles as documentation.
Handle geometry through a thin, explicitly-named raw SQL layer in
`@land-alpha/db/spatial.ts`:

- `geometry` and `centroid` are declared `Unsupported(...)` in `schema.prisma`
  so migrations manage them.
- Writes go through `writeParcelGeometry()` which calls
  `ST_GeomFromGeoJSON` / `ST_SetSRID` inside a parameterised `$executeRaw`.
- Reads go through `readParcelGeometry()` / `queryParcelsInBounds()` which call
  `ST_AsGeoJSON`, `ST_Intersects`, `ST_DWithin` inside `$queryRaw`.
- All measurement (acreage, perimeter, frontage, distance) is computed on the
  geography type (`::geography`) so results are in metres, not degrees.

Every geometry access in the codebase goes through that one module. Application
code never hand-writes spatial SQL.

## Consequences

- One audited file contains all spatial SQL; injection surface is small and reviewable.
- Prisma migrations own the schema, including the `CREATE EXTENSION postgis`
  and the GiST indexes, via a checked-in SQL migration.
