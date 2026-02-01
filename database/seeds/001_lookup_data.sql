-- Seed 001: Lookup tables reference data
-- Populates lookup tables with standard values

-- Forest types
INSERT INTO gis.forest_types (code, name_ru, name_en, description, color_hex) VALUES
('coniferous', 'Хвойный', 'Coniferous', 'Леса с преобладанием хвойных пород', '#1B5E20'),
('deciduous', 'Лиственный', 'Deciduous', 'Леса с преобладанием лиственных пород', '#4CAF50'),
('mixed', 'Смешанный', 'Mixed', 'Смешанные леса', '#8BC34A'),
('shrub', 'Кустарниковый', 'Shrub', 'Кустарниковая растительность', '#CDDC39'),
('sparse', 'Редколесье', 'Sparse', 'Разреженный лесной покров', '#C8E6C9')
ON CONFLICT (code) DO NOTHING;

-- Change types
INSERT INTO gis.change_types (code, name_ru, name_en, description, color_hex, icon) VALUES
('fire', 'Пожар', 'Fire', 'Лесной пожар', '#FF5722', 'fire'),
('logging', 'Вырубка', 'Logging', 'Санитарная или промышленная рубка', '#795548', 'axe'),
('disease', 'Болезнь', 'Disease', 'Поражение вредителями или болезнями', '#9C27B0', 'bug'),
('windfall', 'Ветровал', 'Windfall', 'Повреждение ветром', '#607D8B', 'wind'),
('flood', 'Подтопление', 'Flood', 'Затопление территории', '#2196F3', 'water'),
('regrowth', 'Восстановление', 'Regrowth', 'Естественное восстановление леса', '#4CAF50', 'seedling'),
('planting', 'Посадки', 'Planting', 'Искусственное лесовосстановление', '#8BC34A', 'tree')
ON CONFLICT (code) DO NOTHING;

-- Satellites
INSERT INTO gis.satellites (code, name, operator, launch_date, resolution_m, revisit_days, bands, active) VALUES
('S2A', 'Sentinel-2A', 'ESA', '2015-06-23', 10.0, 5, '["B01","B02","B03","B04","B05","B06","B07","B08","B8A","B09","B10","B11","B12"]', true),
('S2B', 'Sentinel-2B', 'ESA', '2017-03-07', 10.0, 5, '["B01","B02","B03","B04","B05","B06","B07","B08","B8A","B09","B10","B11","B12"]', true),
('L8', 'Landsat-8', 'USGS/NASA', '2013-02-11', 30.0, 16, '["B1","B2","B3","B4","B5","B6","B7","B8","B9","B10","B11"]', true),
('L9', 'Landsat-9', 'USGS/NASA', '2021-09-27', 30.0, 16, '["B1","B2","B3","B4","B5","B6","B7","B8","B9","B10","B11"]', true),
('MODIS_T', 'Terra MODIS', 'NASA', '1999-12-18', 250.0, 1, '["1","2","3","4","5","6","7"]', true),
('MODIS_A', 'Aqua MODIS', 'NASA', '2002-05-04', 250.0, 1, '["1","2","3","4","5","6","7"]', true),
('VIIRS_S', 'VIIRS Suomi NPP', 'NASA/NOAA', '2011-10-28', 375.0, 1, '["I1","I2","I3","I4","I5","M1-M16"]', true),
('VIIRS_N', 'VIIRS NOAA-20', 'NASA/NOAA', '2017-11-18', 375.0, 1, '["I1","I2","I3","I4","I5","M1-M16"]', true)
ON CONFLICT (code) DO NOTHING;

-- Spectral index types
INSERT INTO gis.spectral_index_types (code, name, formula, description, min_value, max_value, healthy_min, healthy_max, color_ramp) VALUES
('NDVI', 'Normalized Difference Vegetation Index', '(NIR - RED) / (NIR + RED)', 'Индекс здоровья растительности', -1.0, 1.0, 0.4, 0.9, '[{"value":-1,"color":"#8B0000"},{"value":0,"color":"#FFFF00"},{"value":0.5,"color":"#00FF00"},{"value":1,"color":"#006400"}]'),
('NBR', 'Normalized Burn Ratio', '(NIR - SWIR2) / (NIR + SWIR2)', 'Индекс выгорания для детекции пожаров', -1.0, 1.0, 0.2, 0.8, '[{"value":-1,"color":"#8B0000"},{"value":0,"color":"#FFFF00"},{"value":1,"color":"#006400"}]'),
('NDWI', 'Normalized Difference Water Index', '(GREEN - NIR) / (GREEN + NIR)', 'Индекс содержания воды в растительности', -1.0, 1.0, -0.3, 0.3, '[{"value":-1,"color":"#8B4513"},{"value":0,"color":"#FFFFFF"},{"value":1,"color":"#0000FF"}]'),
('EVI', 'Enhanced Vegetation Index', '2.5 * (NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1)', 'Улучшенный индекс растительности', -1.0, 1.0, 0.3, 0.8, '[{"value":-1,"color":"#8B0000"},{"value":0,"color":"#FFFF00"},{"value":1,"color":"#006400"}]'),
('SAVI', 'Soil Adjusted Vegetation Index', '(NIR - RED) / (NIR + RED + 0.5) * 1.5', 'Индекс с коррекцией на почву', -1.5, 1.5, 0.3, 1.0, '[{"value":-1.5,"color":"#8B0000"},{"value":0,"color":"#FFFF00"},{"value":1.5,"color":"#006400"}]'),
('NDMI', 'Normalized Difference Moisture Index', '(NIR - SWIR1) / (NIR + SWIR1)', 'Индекс влажности растительности', -1.0, 1.0, 0.0, 0.6, '[{"value":-1,"color":"#8B4513"},{"value":0,"color":"#FFFF00"},{"value":1,"color":"#0000FF"}]'),
('dNBR', 'Differenced Normalized Burn Ratio', 'NBR_pre - NBR_post', 'Разностный индекс выгорания', -2.0, 2.0, null, null, '[{"value":-2,"color":"#006400"},{"value":0,"color":"#FFFFFF"},{"value":2,"color":"#8B0000"}]')
ON CONFLICT (code) DO NOTHING;
