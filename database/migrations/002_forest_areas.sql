-- Migration 002: Forest areas table
-- Stores forest polygons with their characteristics

CREATE TABLE IF NOT EXISTS gis.forest_areas (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    forest_type VARCHAR(50),
    area_ha NUMERIC(12, 2),
    dominant_species VARCHAR(100),
    age_class VARCHAR(20),
    protection_status VARCHAR(50),
    center_lat NUMERIC(9, 6),
    center_lng NUMERIC(10, 6),
    bbox_min_lat NUMERIC(9, 6),
    bbox_min_lng NUMERIC(10, 6),
    bbox_max_lat NUMERIC(9, 6),
    bbox_max_lng NUMERIC(10, 6),
    geojson TEXT,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forest_areas_region ON gis.forest_areas (region);
CREATE INDEX IF NOT EXISTS idx_forest_areas_type ON gis.forest_areas (forest_type);
CREATE INDEX IF NOT EXISTS idx_forest_areas_center ON gis.forest_areas (center_lat, center_lng);

COMMENT ON TABLE gis.forest_areas IS 'Forest area polygons with metadata';
COMMENT ON COLUMN gis.forest_areas.geojson IS 'GeoJSON geometry stored as text';
COMMENT ON COLUMN gis.forest_areas.forest_type IS 'Type: coniferous, deciduous, mixed';
COMMENT ON COLUMN gis.forest_areas.protection_status IS 'Protection level: reserve, national_park, protected, none';
