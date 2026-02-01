# Baikal Forest Monitoring System

## Overview
A GIS monitoring system for Baikal region forests using satellite data. Full-stack TypeScript application with:
- Express backend with PostgreSQL/PostGIS database
- Vite + TypeScript + Tailwind CSS frontend
- TiTiler integration for Cloud Optimized GeoTIFF (COG) processing
- STAC (SpatioTemporal Asset Catalog) API integration
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
│   │   ├── stac.ts             # STAC API proxy endpoints
│   │   └── titiler.ts          # TiTiler proxy endpoints
│   ├── services/
│   │   ├── databaseService.ts  # Database operations
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
│   │   ├── vite-env.d.ts       # Vite type definitions
│   │   ├── api/                # API client modules
│   │   │   ├── index.ts        # API exports
│   │   │   ├── client.ts       # Base API client
│   │   │   ├── health.ts       # Health check API
│   │   │   ├── analytics.ts    # Analytics API
│   │   │   ├── stac.ts         # STAC API
│   │   │   └── titiler.ts      # TiTiler API
│   │   ├── components/         # UI components
│   │   │   ├── index.ts        # Component exports
│   │   │   ├── StatusIndicator.ts
│   │   │   └── MapContainer.ts # Map placeholder (TODO: Leaflet)
│   │   ├── types/              # TypeScript interfaces
│   │   │   └── index.ts
│   │   └── utils/              # Frontend utilities
│   │       ├── index.ts
│   │       └── devAlerts.ts    # Browser dev alerts
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── tsconfig.json
├── tests/                      # Jest test files
│   ├── setup.ts                # Jest setup
│   └── services/
│       └── databaseService.test.ts
├── jest.config.js              # Jest configuration
├── package.json
└── tsconfig.json
```

## Running the Project
- **Backend**: `npm run dev` - Express API on port 3000
- **Frontend**: `npm run dev:client` - Vite dev server on port 5000
- **Tests**: `npm test` - Run Jest tests
- **Both**: Two workflows run simultaneously

## Development Approach

### Modular Architecture
- Code is split into focused modules (api, components, utils, types)
- Each module has single responsibility
- Exports are centralized through index.ts files

### Stubs and Placeholders
- Unimplemented features use stub functions in `src/utils/stubs.ts`
- Stubs return `{ success: false, isStub: true }` for easy detection
- Categories: satelliteImageProcessing, mlPredictions, reportGeneration

### Development Alerts
- `devAlert(level, message, file)` - Log development alerts
- `todo(message)` - Mark TODO items
- `stub(functionName)` - Mark stub implementations
- `needsWork(area, description)` - Mark areas needing work
- `showAlertsSummary()` - Display summary in console
- Alerts only show in development mode

### Alert Levels
- INFO - General information
- WARNING - Areas needing attention
- TODO - Planned improvements
- STUB - Unimplemented functions
- CRITICAL - Urgent issues

## Environment Variables
- `EXTERNAL_DATABASE_URL` - External PostgreSQL connection string (beget.com) - priority
- `DATABASE_URL` - PostgreSQL connection string (Replit fallback)
- `STAC_API_URL` - STAC API endpoint (default: http://localhost:8080)
- `TITILER_URL` - TiTiler service endpoint (default: http://localhost:8000)

## Database
External PostgreSQL database on beget.com (quoquuquosijo.beget.app).

## API Endpoints
- `GET /health` - Health check
- `GET /api/titiler/*` - TiTiler proxy endpoints
- `GET /api/stac/*` - STAC API proxy endpoints
- `GET /api/analytics/*` - Forest analytics endpoints

## Tech Stack
- **Backend**: Node.js, Express, TypeScript, PostgreSQL
- **Frontend**: Vite, TypeScript, Tailwind CSS
- **Testing**: Jest, ts-jest
- **Database**: PostgreSQL with PostGIS (external)

## TODO Areas (marked with alerts)
- [ ] Map integration (Leaflet/MapLibre)
- [ ] STAC API search implementation
- [ ] TiTiler COG preview
- [ ] Navigation handlers
- [ ] Export functionality (PDF, Excel, GeoJSON)
- [ ] Satellite image processing algorithms
- [ ] ML predictions for fire risk
