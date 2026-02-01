-- Migration 008: Fire hotspots from NASA FIRMS
-- Stores fire detections from satellite thermal data

CREATE TABLE IF NOT EXISTS gis.fire_hotspots (
    id SERIAL PRIMARY KEY,
    source VARCHAR(20) NOT NULL,
    satellite VARCHAR(20) NOT NULL,
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,
    brightness NUMERIC(8, 2),
    brightness_t31 NUMERIC(8, 2),
    frp NUMERIC(10, 2),
    scan NUMERIC(5, 2),
    track NUMERIC(5, 2),
    acquisition_date DATE NOT NULL,
    acquisition_time TIME,
    confidence VARCHAR(20),
    confidence_pct INTEGER,
    version VARCHAR(20),
    daynight VARCHAR(1),
    processed BOOLEAN DEFAULT FALSE,
    alert_id INTEGER REFERENCES gis.alerts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fire_hotspots_location ON gis.fire_hotspots (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_fire_hotspots_date ON gis.fire_hotspots (acquisition_date);
CREATE INDEX IF NOT EXISTS idx_fire_hotspots_satellite ON gis.fire_hotspots (satellite);
CREATE INDEX IF NOT EXISTS idx_fire_hotspots_confidence ON gis.fire_hotspots (confidence);
CREATE INDEX IF NOT EXISTS idx_fire_hotspots_processed ON gis.fire_hotspots (processed);

COMMENT ON TABLE gis.fire_hotspots IS 'Fire hotspot detections from NASA FIRMS';
COMMENT ON COLUMN gis.fire_hotspots.source IS 'Data source: MODIS, VIIRS_SNPP, VIIRS_NOAA20';
COMMENT ON COLUMN gis.fire_hotspots.frp IS 'Fire Radiative Power in MW';
COMMENT ON COLUMN gis.fire_hotspots.confidence IS 'Detection confidence: low, nominal, high';
