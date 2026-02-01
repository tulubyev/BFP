-- Migration 006: Monitoring zones table
-- Defines areas of special interest for monitoring

CREATE TABLE IF NOT EXISTS gis.monitoring_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    zone_type VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    monitoring_frequency VARCHAR(20) DEFAULT 'weekly',
    description TEXT,
    responsible_org VARCHAR(255),
    contact_email VARCHAR(255),
    active BOOLEAN DEFAULT TRUE,
    center_lat NUMERIC(9, 6),
    center_lng NUMERIC(10, 6),
    bbox_min_lat NUMERIC(9, 6),
    bbox_min_lng NUMERIC(10, 6),
    bbox_max_lat NUMERIC(9, 6),
    bbox_max_lng NUMERIC(10, 6),
    geojson TEXT,
    alert_thresholds JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitoring_zones_type ON gis.monitoring_zones (zone_type);
CREATE INDEX IF NOT EXISTS idx_monitoring_zones_priority ON gis.monitoring_zones (priority);
CREATE INDEX IF NOT EXISTS idx_monitoring_zones_active ON gis.monitoring_zones (active);

COMMENT ON TABLE gis.monitoring_zones IS 'Special monitoring zones with alert thresholds';
COMMENT ON COLUMN gis.monitoring_zones.zone_type IS 'Type: fire_risk, protected, logging, restoration';
COMMENT ON COLUMN gis.monitoring_zones.priority IS 'Priority: low, medium, high, critical';
