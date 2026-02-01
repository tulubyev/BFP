-- Migration 003: Forest changes table
-- Records detected changes: fires, logging, disease, regrowth

CREATE TABLE IF NOT EXISTS gis.forest_changes (
    id SERIAL PRIMARY KEY,
    forest_area_id INTEGER REFERENCES gis.forest_areas(id) ON DELETE SET NULL,
    change_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20),
    detected_date DATE NOT NULL,
    confirmed_date DATE,
    area_ha NUMERIC(10, 2),
    confidence NUMERIC(3, 2),
    source VARCHAR(50),
    satellite VARCHAR(50),
    scene_id VARCHAR(100),
    center_lat NUMERIC(9, 6),
    center_lng NUMERIC(10, 6),
    bbox_min_lat NUMERIC(9, 6),
    bbox_min_lng NUMERIC(10, 6),
    bbox_max_lat NUMERIC(9, 6),
    bbox_max_lng NUMERIC(10, 6),
    geojson TEXT,
    metadata JSONB DEFAULT '{}',
    logging_permit_id VARCHAR(100), -- Номер разрешения на вырубку
    contractor_name VARCHAR(255),  -- Исполнитель работ
    control_authority VARCHAR(255), -- Контролирующее ведомство
    permit_expiry_date DATE,       -- Срок действия разрешения
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_forest_changes_type ON gis.forest_changes (change_type);
CREATE INDEX IF NOT EXISTS idx_forest_changes_date ON gis.forest_changes (detected_date);
CREATE INDEX IF NOT EXISTS idx_forest_changes_severity ON gis.forest_changes (severity);
CREATE INDEX IF NOT EXISTS idx_forest_changes_center ON gis.forest_changes (center_lat, center_lng);

COMMENT ON TABLE gis.forest_changes IS 'Detected forest changes and disturbances';
COMMENT ON COLUMN gis.forest_changes.change_type IS 'Type: fire, logging, disease, windfall, regrowth, other';
COMMENT ON COLUMN gis.forest_changes.severity IS 'Severity level: low, medium, high, critical';
COMMENT ON COLUMN gis.forest_changes.confidence IS 'Detection confidence 0.00-1.00';
