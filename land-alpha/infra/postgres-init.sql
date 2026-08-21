-- Runs once when the Postgres container is first created.
--
-- The shadow database is required by `prisma migrate dev`, which verifies each
-- migration against a clean schema before applying it. PostGIS is enabled by
-- the first Prisma migration, not here, so the extension state stays under
-- migration control.
CREATE DATABASE landalpha_shadow;
