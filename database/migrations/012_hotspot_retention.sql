-- 012: retention of FIRMS hotspot history (gis.fire_hotspots): keep the last 30 days.
--
-- The application role (forestwatch_app, database/admin/001_app_role.sql) has no DELETE. Instead of
-- granting it DELETE on the whole table, it gets EXECUTE on this one function, which can only delete
-- hotspots older than 30 days — so even a SQL injection cannot remove recent data.
-- The number 30 must match HOTSPOT_RETENTION_DAYS in backend/services/hotspotRetention.ts
-- (tests/services/hotspotRetention.test.ts checks it).
--
-- Apply as the table owner (the app role cannot create functions). Idempotent:
--   sudo -u postgres psql -d forest_db -v ON_ERROR_STOP=1 -f /var/www/forestwatch/database/migrations/012_hotspot_retention.sql
-- (the first line switches to tulubyev, so the function is owned by tulubyev, not by the superuser).

SET ROLE tulubyev;

BEGIN;

CREATE OR REPLACE FUNCTION gis.purge_old_hotspots() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gis, pg_temp
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM gis.fire_hotspots WHERE acquisition_date < CURRENT_DATE - 30;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;

REVOKE ALL ON FUNCTION gis.purge_old_hotspots() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'forestwatch_app') THEN
    GRANT EXECUTE ON FUNCTION gis.purge_old_hotspots() TO forestwatch_app;
  END IF;
END
$$;

COMMIT;

RESET ROLE;

-- Check: the owner is tulubyev, forestwatch_app may execute, PUBLIC may not.
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       has_function_privilege('forestwatch_app', p.oid, 'EXECUTE') AS app_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'gis' AND p.proname = 'purge_old_hotspots';
