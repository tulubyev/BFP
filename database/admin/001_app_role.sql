-- forestwatch_app: least-privilege PostgreSQL role for the forestwatch.ru application.
--
-- Not a migration: it needs a superuser and is run once by the owner on the VPS.
-- The app today connects as `tulubyev`, which owns every table in schema gis, so any SQL
-- injection could change or drop data (one was found and fixed on 2026-09-27, commit 22e82b7).
-- This role can only do what the code does (checked against every query in backend/):
--   gis.fire_hotspots   SELECT, INSERT          FIRMS history (hotspotRows.ts), NRT counts, hotspots API
--   gis.forest_changes  SELECT, INSERT, UPDATE  FIRMS incidents (firmsHistory/store.ts), feed, export
--   gis.forest_areas    SELECT                  LEFT JOIN in the feed, region list
--   sequences of the two serial ids             nextval() on INSERT
-- No DELETE, no DDL, no other tables, no CREATE in the schema. pg_advisory_xact_lock is
-- available to every role by default.
--
-- Run (idempotent — safe to run again, it resets the grants to exactly this set):
--   sudo -u postgres psql -d forest_db -v ON_ERROR_STOP=1 -f /var/www/forestwatch/database/admin/001_app_role.sql
-- Set the password interactively (never in a file or shell history), e.g. from `openssl rand -hex 24`:
--   sudo -u postgres psql -d forest_db -c '\password forestwatch_app'
-- Then in /var/www/forestwatch/.env:
--   DATABASE_URL=postgresql://forestwatch_app:<password>@172.28.0.1:5432/forest_db
-- and `bash deploy.sh` to recreate the container with the new URL.
--
-- When a migration adds a table the app uses, add its GRANT here too (a re-run revokes everything
-- not listed below).
-- Rollback: put the old DATABASE_URL back and `bash deploy.sh`; the role can stay.
-- Migrations keep running as `tulubyev` (the table owner), not through the app container.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'forestwatch_app') THEN
    CREATE ROLE forestwatch_app LOGIN;
  END IF;
END
$$;

-- Pool max is 20 per container; 40 leaves room for the old and new container during a deploy.
ALTER ROLE forestwatch_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 40;
-- A runaway query or a transaction left open cannot hold locks for long.
-- 120 s covers the slowest legitimate work (FIRMS history run waiting on its advisory lock).
ALTER ROLE forestwatch_app IN DATABASE forest_db SET statement_timeout = '120s';
ALTER ROLE forestwatch_app IN DATABASE forest_db SET idle_in_transaction_session_timeout = '60s';

GRANT CONNECT ON DATABASE forest_db TO forestwatch_app;
GRANT USAGE ON SCHEMA gis TO forestwatch_app;

-- Start from nothing, then grant exactly what the code uses.
REVOKE ALL ON ALL TABLES IN SCHEMA gis FROM forestwatch_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA gis FROM forestwatch_app;

GRANT SELECT, INSERT         ON gis.fire_hotspots  TO forestwatch_app;
GRANT SELECT, INSERT, UPDATE ON gis.forest_changes TO forestwatch_app;
GRANT SELECT                 ON gis.forest_areas   TO forestwatch_app;
GRANT USAGE ON SEQUENCE gis.fire_hotspots_id_seq, gis.forest_changes_id_seq TO forestwatch_app;

-- Tables created later by migrations (run as tulubyev) are readable by the app at once;
-- anything the app must write gets an explicit GRANT in its migration.
-- FOR ROLE tulubyev is required: this script runs as postgres (see Mentingo RUNBOOK, 2026-09-25).
ALTER DEFAULT PRIVILEGES FOR ROLE tulubyev IN SCHEMA gis GRANT SELECT ON TABLES TO forestwatch_app;

COMMIT;

-- Check: expected t/t/f/f for fire_hotspots, t/t/t/f for forest_changes, t/f/f/f for forest_areas,
-- f everywhere for the rest, and no CREATE on the schema.
SELECT c.relname AS table,
       has_table_privilege('forestwatch_app', c.oid, 'SELECT') AS sel,
       has_table_privilege('forestwatch_app', c.oid, 'INSERT') AS ins,
       has_table_privilege('forestwatch_app', c.oid, 'UPDATE') AS upd,
       has_table_privilege('forestwatch_app', c.oid, 'DELETE') AS del
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'gis' AND c.relkind = 'r'
ORDER BY 1;

SELECT has_schema_privilege('forestwatch_app', 'gis', 'CREATE') AS can_create_in_gis,
       rolsuper, rolcreatedb, rolconnlimit
FROM pg_roles WHERE rolname = 'forestwatch_app';
