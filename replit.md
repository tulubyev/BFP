# Baikal Forest Monitoring System

## Overview
A GIS monitoring system for Baikal region forests using satellite data. This is a Node.js/TypeScript Express backend that provides APIs for:
- TiTiler integration for Cloud Optimized GeoTIFF (COG) processing
- STAC (SpatioTemporal Asset Catalog) API integration
- Forest analytics with PostgreSQL/PostGIS database

## Project Structure
```
├── src/
│   ├── server.ts           # Main Express server (port 5000)
│   ├── config/
│   │   ├── database.ts     # PostgreSQL connection pool
│   │   └── titiler.ts      # TiTiler service config
│   ├── models/
│   │   └── forestArea.ts   # Forest area & change interfaces
│   ├── routes/
│   │   ├── analytics.ts    # Forest analytics endpoints
│   │   ├── stac.ts         # STAC API proxy endpoints
│   │   └── titiler.ts      # TiTiler proxy endpoints
│   └── services/
│       ├── databaseService.ts  # Database operations
│       ├── stacService.ts      # STAC API client
│       └── titilerService.ts   # TiTiler API client
├── public/
│   └── index.html          # Frontend documentation
├── package.json
└── tsconfig.json
```

## Running the Project
The server runs on port 5000 using `npm run dev` which uses ts-node with tsconfig-paths.

## Environment Variables
- `EXTERNAL_DATABASE_URL` - External PostgreSQL connection string (beget.com) - takes priority
- `DATABASE_URL` - PostgreSQL connection string (Replit fallback)
- `STAC_API_URL` - STAC API endpoint (default: http://localhost:8080)
- `TITILER_URL` - TiTiler service endpoint (default: http://localhost:8000)

## Database
Currently using external PostgreSQL database on beget.com (quoquuquosijo.beget.app).

## API Endpoints
- `GET /health` - Health check
- `GET /api/titiler/*` - TiTiler proxy endpoints
- `GET /api/stac/*` - STAC API proxy endpoints
- `GET /api/analytics/*` - Forest analytics endpoints
