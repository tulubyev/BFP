-- Migration 001: Initialize schema (PostGIS optional)
-- PostGIS extensions are created only if available

CREATE SCHEMA IF NOT EXISTS gis;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS postgis_topology;
    RAISE NOTICE 'PostGIS extensions enabled';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS not available - using fallback geometry storage';
END $$;

COMMENT ON SCHEMA gis IS 'GIS data for Baikal Forest Monitoring System';
