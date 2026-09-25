-- Migration 011: FIRMS history and fire incidents (#11)
-- Additive and idempotent: safe to run more than once, never drops or rewrites data.
-- Apply on production BEFORE merging the code that writes FIRMS hotspots into gis.fire_hotspots.

-- One row per satellite observation: lets the ingestion job use INSERT ... ON CONFLICT DO NOTHING,
-- so re-importing the same 24 h snapshot every 30 min never creates duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS fire_hotspots_observation_uniq
    ON gis.fire_hotspots (satellite, acquisition_date, acquisition_time, latitude, longitude);

-- 72 h clustering window and history queries by date. Same name as in 008, so this is a no-op
-- where 008 already created it.
CREATE INDEX IF NOT EXISTS idx_fire_hotspots_date
    ON gis.fire_hotspots (acquisition_date);

-- Incident feed and lookup of FIRMS incidents by source and date.
CREATE INDEX IF NOT EXISTS idx_forest_changes_source_date
    ON gis.forest_changes (source, detected_date);
