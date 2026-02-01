# Baikal Forest Monitoring System

## Overview
A GIS monitoring system for Baikal region forests using satellite data. Full-stack TypeScript application with:
- Express backend with PostgreSQL database
- Vite + TypeScript + Tailwind CSS frontend
- Leaflet interactive map integration
- NASA FIRMS fire hotspot integration
- Global Forest Watch deforestation data
- Spectral indices calculations (NDVI, NBR, EVI, etc.)
- Jest testing framework

## Project Structure
```
├── src/                        # Backend (Express + TypeScript)
│   ├── server.ts               # Main Express server (port 3000)
│   ├── config/
│   │   ├── database.ts         # PostgreSQL connection pool
│   │   └── titiler.ts          # TiTiler service config
│   ├── models/
│   │   └── forestArea.ts       # Forest area & change interfaces
│   ├── routes/
│   │   ├── analytics.ts        # Forest analytics endpoints
│   │   ├── monitoring.ts       # Monitoring data endpoints (NEW)
│   │   ├── stac.ts             # STAC API proxy endpoints
│   │   └── titiler.ts          # TiTiler proxy endpoints
│   ├── services/
│   │   ├── databaseService.ts  # Database operations
│   │   ├── spectralIndices.ts  # NDVI, NBR, EVI calculators (NEW)
│   │   ├── firmsService.ts     # NASA FIRMS integration (NEW)
│   │   ├── globalForestWatch.ts # GFW API integration (NEW)
│   │   ├── stacService.ts      # STAC API client
│   │   └── titilerService.ts   # TiTiler API client
│   └── utils/
│       ├── devAlerts.ts        # Development alerts/warnings system
│       └── stubs.ts            # Stub functions for unimplemented features
├── client/                     # Frontend (Vite + TypeScript + Tailwind)
│   ├── index.html              # Main HTML entry point
│   ├── src/
│   │   ├── main.ts             # TypeScript entry point
│   │   ├── style.css           # Tailwind CSS styles
│   │   ├── api/                # API client modules
│   │   ├── components/
│   │   │   ├── StatusIndicator.ts
│   │   │   └── MapContainer.ts # Leaflet map integration (IMPLEMENTED)
│   │   ├── types/
│   │   └── utils/
│   ├── vite.config.ts
│   └── tailwind.config.js
├── database/                   # Database migrations (NEW)
│   ├── migrations/             # SQL migration files
│   │   ├── 001_init_postgis.sql
│   │   ├── 002_forest_areas.sql
│   │   ├── 003_forest_changes.sql
│   │   ├── 004_satellite_scenes.sql
│   │   ├── 005_spectral_indices.sql
│   │   ├── 006_monitoring_zones.sql
│   │   ├── 007_alerts.sql
│   │   ├── 008_fire_hotspots.sql
│   │   ├── 009_reports.sql
│   │   └── 010_lookup_tables.sql
│   ├── seeds/                  # Seed data
│   │   ├── 001_lookup_data.sql
│   │   └── 002_baikal_data.sql
│   └── run-migrations.ts
├── docs/                       # Documentation
│   ├── README.md
│   ├── DEVELOPMENT.md
│   └── ARCHITECTURE.md
├── tests/                      # Jest test files
├── jest.config.js
└── package.json
```

## Running the Project
- **Backend**: `npm run dev` - Express API on port 3000
- **Frontend**: `npm run dev:client` - Vite dev server on port 5000
- **Tests**: `npm test` - Run Jest tests
- **Database**: `npm run db:setup` - Run migrations and seeds
- **Both**: Two workflows run simultaneously

## Database Schema (gis schema)
- `forest_areas` - Forest polygons with metadata
- `forest_changes` - Detected changes (fire, logging, disease)
- `satellite_scenes` - Satellite imagery metadata
- `spectral_indices` - Calculated vegetation indices
- `monitoring_zones` - Special monitoring areas
- `alerts` - System alerts and notifications
- `fire_hotspots` - NASA FIRMS fire data
- `reports` - Generated analysis reports
- `forest_types`, `change_types`, `satellites` - Lookup tables

## API Endpoints
- `GET /health` - Health check
- `GET /api/monitoring/forest-areas` - Forest areas list
- `GET /api/monitoring/forest-areas/geojson` - Forest areas as GeoJSON
- `GET /api/monitoring/forest-changes` - Forest change events
- `GET /api/monitoring/forest-changes/geojson` - Changes as GeoJSON
- `GET /api/monitoring/fire-hotspots` - Fire hotspot data
- `GET /api/monitoring/fire-hotspots/firms` - NASA FIRMS live data
- `GET /api/monitoring/monitoring-zones` - Monitoring zones
- `GET /api/monitoring/alerts` - System alerts
- `GET /api/monitoring/statistics` - Summary statistics
- `GET /api/monitoring/spectral-indices/info` - Index formulas
- `POST /api/monitoring/spectral-indices/calculate` - Calculate index
- `GET /api/monitoring/gfw/tree-cover-loss` - GFW deforestation data
- `GET /api/monitoring/lookup/:table` - Lookup table data
- `GET /api/titiler/*` - TiTiler proxy endpoints
- `GET /api/stac/*` - STAC API proxy endpoints

## Spectral Indices
Implemented in `src/services/spectralIndices.ts`:
- **NDVI** - Normalized Difference Vegetation Index
- **NBR** - Normalized Burn Ratio
- **NDWI** - Normalized Difference Water Index
- **EVI** - Enhanced Vegetation Index
- **SAVI** - Soil Adjusted Vegetation Index
- **NDMI** - Normalized Difference Moisture Index
- **dNBR** - Differenced NBR for burn severity

## External Integrations
- **NASA FIRMS** - Fire hotspot data (VIIRS/MODIS)
- **Global Forest Watch** - Tree cover loss data
- **TiTiler** - COG tile server (pending external service)
- **STAC API** - Satellite catalog (pending external service)

## Environment Variables
- `EXTERNAL_DATABASE_URL` - PostgreSQL connection (beget.com)
- `DATABASE_URL` - PostgreSQL fallback (Replit)
- `NASA_FIRMS_API_KEY` - NASA FIRMS API key (optional)
- `GFW_API_KEY` - Global Forest Watch API key (optional)
- `STAC_API_URL` - STAC API endpoint
- `TITILER_URL` - TiTiler service endpoint

## Tech Stack
- **Backend**: Node.js, Express, TypeScript, PostgreSQL
- **Frontend**: Vite, TypeScript, Tailwind CSS, Leaflet
- **Maps**: Leaflet with OSM, ESRI, CartoDB base layers
- **Testing**: Jest, ts-jest
- **Database**: PostgreSQL on beget.com

## Documentation
See `docs/` folder for detailed documentation:
- `docs/README.md` - Project overview
- `docs/DEVELOPMENT.md` - Development guidelines
- `docs/ARCHITECTURE.md` - System architecture

## Completed Features
- [x] Database schema with 10 tables
- [x] Seed data for Baikal region
- [x] Leaflet map integration
- [x] Spectral indices calculator
- [x] NASA FIRMS service
- [x] Global Forest Watch service
- [x] Monitoring API endpoints
- [x] GeoJSON export endpoints

## TODO Areas
- [ ] TiTiler COG preview (requires external TiTiler)
- [ ] STAC API search (requires external STAC catalog)
- [ ] Export functionality (PDF, Excel reports)
- [ ] ML predictions for fire risk
- [ ] Real-time alert notifications
