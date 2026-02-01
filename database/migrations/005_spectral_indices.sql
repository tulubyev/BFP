-- Migration 005: Spectral indices table
-- Stores calculated vegetation and burn indices

CREATE TABLE IF NOT EXISTS gis.spectral_indices (
    id SERIAL PRIMARY KEY,
    scene_id INTEGER REFERENCES gis.satellite_scenes(id) ON DELETE CASCADE,
    forest_area_id INTEGER REFERENCES gis.forest_areas(id) ON DELETE SET NULL,
    index_type VARCHAR(20) NOT NULL,
    calculation_date TIMESTAMP WITH TIME ZONE NOT NULL,
    mean_value NUMERIC(6, 4),
    min_value NUMERIC(6, 4),
    max_value NUMERIC(6, 4),
    std_dev NUMERIC(6, 4),
    pixel_count INTEGER,
    cog_url TEXT,
    center_lat NUMERIC(9, 6),
    center_lng NUMERIC(10, 6),
    histogram JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spectral_indices_type ON gis.spectral_indices (index_type);
CREATE INDEX IF NOT EXISTS idx_spectral_indices_date ON gis.spectral_indices (calculation_date);
CREATE INDEX IF NOT EXISTS idx_spectral_indices_scene ON gis.spectral_indices (scene_id);

COMMENT ON TABLE gis.spectral_indices IS 'Calculated spectral vegetation indices';
COMMENT ON COLUMN gis.spectral_indices.index_type IS 'Index type: NDVI, NBR, NDWI, EVI, SAVI, NDMI';
COMMENT ON COLUMN gis.spectral_indices.mean_value IS 'Mean index value for the area (-1.0 to 1.0)';
