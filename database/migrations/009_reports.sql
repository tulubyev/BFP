-- Migration 009: Reports table
-- Stores generated analysis reports

CREATE TABLE IF NOT EXISTS gis.reports (
    id SERIAL PRIMARY KEY,
    report_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    period_start DATE,
    period_end DATE,
    format VARCHAR(20) NOT NULL,
    file_url TEXT,
    file_size INTEGER,
    parameters JSONB DEFAULT '{}',
    summary JSONB DEFAULT '{}',
    generated_by VARCHAR(100),
    bbox_min_lat NUMERIC(9, 6),
    bbox_min_lng NUMERIC(10, 6),
    bbox_max_lat NUMERIC(9, 6),
    bbox_max_lng NUMERIC(10, 6),
    status VARCHAR(20) DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_type ON gis.reports (report_type);
CREATE INDEX IF NOT EXISTS idx_reports_period ON gis.reports (period_start, period_end);

COMMENT ON TABLE gis.reports IS 'Generated analysis and monitoring reports';
COMMENT ON COLUMN gis.reports.report_type IS 'Type: fire_summary, forest_change, ndvi_analysis, annual';
COMMENT ON COLUMN gis.reports.format IS 'Format: pdf, xlsx, geojson, csv';
