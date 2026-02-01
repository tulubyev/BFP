-- Migration 010: Lookup tables and reference data
-- Stores enumerations and reference values

CREATE TABLE IF NOT EXISTS gis.forest_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    color_hex VARCHAR(7)
);

CREATE TABLE IF NOT EXISTS gis.change_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    color_hex VARCHAR(7),
    icon VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS gis.satellites (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    operator VARCHAR(100),
    launch_date DATE,
    resolution_m NUMERIC(6, 2),
    revisit_days INTEGER,
    bands JSONB DEFAULT '[]',
    active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS gis.spectral_index_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    formula TEXT,
    description TEXT,
    min_value NUMERIC(6, 4) DEFAULT -1.0,
    max_value NUMERIC(6, 4) DEFAULT 1.0,
    healthy_min NUMERIC(6, 4),
    healthy_max NUMERIC(6, 4),
    color_ramp JSONB DEFAULT '[]'
);

COMMENT ON TABLE gis.forest_types IS 'Forest type classification lookup';
COMMENT ON TABLE gis.change_types IS 'Forest change type classification lookup';
COMMENT ON TABLE gis.satellites IS 'Satellite sensor reference data';
COMMENT ON TABLE gis.spectral_index_types IS 'Spectral index definitions and thresholds';
