-- Seed 002: Baikal region sample data
-- Sample forest areas and monitoring zones for the Baikal region

-- Sample forest areas around Lake Baikal
INSERT INTO gis.forest_areas (name, region, forest_type, area_ha, dominant_species, age_class, protection_status, center_lat, center_lng, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, geojson, properties) VALUES
(
    'Баргузинский заповедник',
    'Республика Бурятия',
    'coniferous',
    374322.0,
    'Кедр сибирский, Пихта сибирская',
    'mature',
    'reserve',
    54.5, 109.75,
    54.0, 109.0, 55.0, 110.5,
    '{"type":"Polygon","coordinates":[[[109.0,54.0],[110.5,54.0],[110.5,55.0],[109.0,55.0],[109.0,54.0]]]}',
    '{"founded": 1916, "unesco": true, "biosphere": true}'
),
(
    'Байкальский заповедник',
    'Республика Бурятия',
    'mixed',
    165724.0,
    'Кедр, Лиственница, Береза',
    'mature',
    'reserve',
    51.4, 105.5,
    51.0, 105.0, 51.8, 106.0,
    '{"type":"Polygon","coordinates":[[[105.0,51.0],[106.0,51.0],[106.0,51.8],[105.0,51.8],[105.0,51.0]]]}',
    '{"founded": 1969, "biosphere": true}'
),
(
    'Прибайкальский национальный парк',
    'Иркутская область',
    'mixed',
    417297.0,
    'Сосна, Лиственница, Кедр',
    'mixed',
    'national_park',
    52.75, 106.25,
    52.0, 105.5, 53.5, 107.0,
    '{"type":"Polygon","coordinates":[[[105.5,52.0],[107.0,52.0],[107.0,53.5],[105.5,53.5],[105.5,52.0]]]}',
    '{"founded": 1986}'
),
(
    'Забайкальский национальный парк',
    'Республика Бурятия',
    'coniferous',
    269100.0,
    'Лиственница, Кедр, Сосна',
    'mature',
    'national_park',
    53.5, 109.0,
    53.0, 108.5, 54.0, 109.5,
    '{"type":"Polygon","coordinates":[[[108.5,53.0],[109.5,53.0],[109.5,54.0],[108.5,54.0],[108.5,53.0]]]}',
    '{"founded": 1986}'
),
(
    'Тункинский национальный парк',
    'Республика Бурятия',
    'mixed',
    1183662.0,
    'Кедр, Лиственница, Ель',
    'mixed',
    'national_park',
    52.0, 101.5,
    51.5, 100.5, 52.5, 102.5,
    '{"type":"Polygon","coordinates":[[[100.5,51.5],[102.5,51.5],[102.5,52.5],[100.5,52.5],[100.5,51.5]]]}',
    '{"founded": 1991}'
)
ON CONFLICT DO NOTHING;

-- Sample monitoring zones
INSERT INTO gis.monitoring_zones (name, zone_type, priority, monitoring_frequency, description, center_lat, center_lng, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, geojson, alert_thresholds) VALUES
(
    'Зона пожарного риска - Северный Байкал',
    'fire_risk',
    'high',
    'daily',
    'Высокий риск пожаров в летний период',
    55.5, 109.5,
    55.0, 109.0, 56.0, 110.0,
    '{"type":"Polygon","coordinates":[[[109.0,55.0],[110.0,55.0],[110.0,56.0],[109.0,56.0],[109.0,55.0]]]}',
    '{"ndvi_drop": 0.15, "nbr_threshold": -0.2, "frp_min": 10}'
),
(
    'Буферная зона Баргузинского заповедника',
    'protected',
    'high',
    'weekly',
    'Охранная зона заповедника',
    54.5, 109.75,
    53.5, 108.5, 55.5, 111.0,
    '{"type":"Polygon","coordinates":[[[108.5,53.5],[111.0,53.5],[111.0,55.5],[108.5,55.5],[108.5,53.5]]]}',
    '{"logging_detection": true, "boundary_violation": true}'
),
(
    'Лесовосстановление - Южный Байкал',
    'restoration',
    'medium',
    'monthly',
    'Зона мониторинга лесовосстановления после пожаров 2015 года',
    51.5, 105.25,
    51.0, 104.5, 52.0, 106.0,
    '{"type":"Polygon","coordinates":[[[104.5,51.0],[106.0,51.0],[106.0,52.0],[104.5,52.0],[104.5,51.0]]]}',
    '{"ndvi_increase": 0.05, "canopy_recovery": true}'
)
ON CONFLICT DO NOTHING;

-- Sample historical forest changes
INSERT INTO gis.forest_changes (forest_area_id, change_type, severity, detected_date, area_ha, confidence, source, satellite, center_lat, center_lng, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, geojson, metadata) VALUES
(
    1,
    'fire',
    'high',
    '2023-07-15',
    245.5,
    0.92,
    'satellite',
    'Sentinel-2A',
    54.325, 109.25,
    54.3, 109.2, 54.35, 109.3,
    '{"type":"Polygon","coordinates":[[[109.2,54.3],[109.3,54.3],[109.3,54.35],[109.2,54.35],[109.2,54.3]]]}',
    '{"cause": "lightning", "suppressed": true, "days_active": 3}'
),
(
    2,
    'logging',
    'medium',
    '2023-09-20',
    12.3,
    0.85,
    'satellite',
    'Landsat-9',
    51.41, 105.525,
    51.4, 105.5, 51.42, 105.55,
    '{"type":"Polygon","coordinates":[[[105.5,51.4],[105.55,51.4],[105.55,51.42],[105.5,51.42],[105.5,51.4]]]}',
    '{"type": "sanitary", "authorized": true}'
),
(
    3,
    'disease',
    'medium',
    '2023-08-10',
    89.7,
    0.78,
    'ground',
    null,
    52.55, 106.3,
    52.5, 106.2, 52.6, 106.4,
    '{"type":"Polygon","coordinates":[[[106.2,52.5],[106.4,52.5],[106.4,52.6],[106.2,52.6],[106.2,52.5]]]}',
    '{"pest": "siberian_moth", "trees_affected": 15000}'
),
(
    1,
    'regrowth',
    'low',
    '2024-06-01',
    180.0,
    0.88,
    'satellite',
    'Sentinel-2B',
    54.285, 109.2,
    54.25, 109.15, 54.32, 109.25,
    '{"type":"Polygon","coordinates":[[[109.15,54.25],[109.25,54.25],[109.25,54.32],[109.15,54.32],[109.15,54.25]]]}',
    '{"years_since_fire": 1, "ndvi_recovery": 0.35}'
)
ON CONFLICT DO NOTHING;

-- Sample satellite scene metadata
INSERT INTO gis.satellite_scenes (scene_id, satellite, sensor, acquisition_date, cloud_cover, sun_elevation, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng, bands, status) VALUES
(
    'S2A_MSIL2A_20240115T041241_N0510_R090_T48UXA_20240115T070123',
    'Sentinel-2A',
    'MSI',
    '2024-01-15 04:12:41+00',
    5.2,
    22.5,
    51.0, 105.0, 52.0, 106.5,
    '["B02","B03","B04","B05","B06","B07","B08","B8A","B11","B12"]',
    'available'
),
(
    'LC09_L2SP_133024_20240120_20240121_02_T1',
    'Landsat-9',
    'OLI',
    '2024-01-20 03:45:00+00',
    12.8,
    18.3,
    53.0, 108.0, 55.0, 110.0,
    '["B1","B2","B3","B4","B5","B6","B7"]',
    'available'
)
ON CONFLICT DO NOTHING;

-- Sample fire hotspots
INSERT INTO gis.fire_hotspots (source, satellite, latitude, longitude, brightness, frp, acquisition_date, acquisition_time, confidence, daynight) VALUES
('VIIRS', 'VIIRS_SNPP', 54.32, 109.25, 320.5, 15.8, '2023-07-15', '14:30:00', 'high', 'D'),
('VIIRS', 'VIIRS_SNPP', 54.33, 109.26, 315.2, 12.4, '2023-07-15', '14:30:00', 'nominal', 'D'),
('MODIS', 'Terra', 55.12, 109.45, 340.1, 25.6, '2023-07-20', '10:15:00', 'high', 'D'),
('VIIRS', 'VIIRS_NOAA20', 51.85, 105.32, 295.3, 8.2, '2023-08-05', '13:45:00', 'nominal', 'D')
ON CONFLICT DO NOTHING;
