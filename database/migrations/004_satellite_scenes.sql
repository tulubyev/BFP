-- Migration 004: Satellite scenes metadata
-- Stores information about processed satellite imagery

CREATE TABLE IF NOT EXISTS gis.satellite_scenes (
    id SERIAL PRIMARY KEY,
    scene_id VARCHAR(100) UNIQUE NOT NULL,
    satellite VARCHAR(50) NOT NULL,
    sensor VARCHAR(50),
    acquisition_date TIMESTAMP WITH TIME ZONE NOT NULL,
    processing_date TIMESTAMP WITH TIME ZONE,
    cloud_cover NUMERIC(5, 2),
    sun_elevation NUMERIC(5, 2),
    sun_azimuth NUMERIC(5, 2),
    cog_url TEXT,
    thumbnail_url TEXT,
    bbox_min_lat NUMERIC(9, 6),
    bbox_min_lng NUMERIC(10, 6),
    bbox_max_lat NUMERIC(9, 6),
    bbox_max_lng NUMERIC(10, 6),
    bands JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'available',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_satellite_scenes_date ON gis.satellite_scenes (acquisition_date);
CREATE INDEX IF NOT EXISTS idx_satellite_scenes_satellite ON gis.satellite_scenes (satellite);
CREATE INDEX IF NOT EXISTS idx_satellite_scenes_cloud ON gis.satellite_scenes (cloud_cover);
CREATE INDEX IF NOT EXISTS idx_satellite_scenes_bbox ON gis.satellite_scenes (bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);

COMMENT ON TABLE gis.satellite_scenes IS 'Satellite imagery metadata catalog';
COMMENT ON COLUMN gis.satellite_scenes.satellite IS 'Satellite: Sentinel-2, Landsat-8, Landsat-9, MODIS';
COMMENT ON COLUMN gis.satellite_scenes.cog_url IS 'Cloud Optimized GeoTIFF URL for TiTiler';
