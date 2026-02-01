-- Migration 007: Alerts table
-- Stores generated alerts and notifications

CREATE TABLE IF NOT EXISTS gis.alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    forest_change_id INTEGER REFERENCES gis.forest_changes(id) ON DELETE SET NULL,
    monitoring_zone_id INTEGER REFERENCES gis.monitoring_zones(id) ON DELETE SET NULL,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'new',
    latitude NUMERIC(9, 6),
    longitude NUMERIC(10, 6),
    area_affected_ha NUMERIC(10, 2),
    source VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_type ON gis.alerts (alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON gis.alerts (severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON gis.alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_detected ON gis.alerts (detected_at);
CREATE INDEX IF NOT EXISTS idx_alerts_location ON gis.alerts (latitude, longitude);

COMMENT ON TABLE gis.alerts IS 'System alerts and notifications';
COMMENT ON COLUMN gis.alerts.alert_type IS 'Type: fire, logging, ndvi_drop, boundary_violation';
COMMENT ON COLUMN gis.alerts.severity IS 'Severity: info, warning, critical, emergency';
COMMENT ON COLUMN gis.alerts.status IS 'Status: new, acknowledged, investigating, resolved, false_positive';
