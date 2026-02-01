# Baikal Forest Monitoring System

## Overview
A GIS monitoring system for Baikal region forests using satellite data. Full-stack TypeScript application with:
- Express backend with PostgreSQL/PostGIS database
- Vite + TypeScript + Tailwind CSS frontend
- TiTiler integration for Cloud Optimized GeoTIFF (COG) processing
- STAC (SpatioTemporal Asset Catalog) API integration

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
│   └── services/
│       ├── databaseService.ts  # Database operations
│       ├── stacService.ts      # STAC API client
│       └── titilerService.ts   # TiTiler API client
├── client/                     # Frontend (Vite + TypeScript + Tailwind)
│   ├── index.html              # Main HTML entry point
│   ├── src/
│   │   ├── main.ts             # TypeScript entry point
│   │   └── style.css           # Tailwind CSS styles
│   ├── vite.config.ts          # Vite configuration
│   ├── tailwind.config.js      # Tailwind configuration
│   └── postcss.config.js       # PostCSS configuration
├── public/                     # Built frontend output
├── package.json
└── tsconfig.json
```

## Running the Project
- **Backend**: `npm run dev` - Express API on port 3000
- **Frontend**: `npm run dev:client` - Vite dev server on port 5000
- **Both**: Two workflows run simultaneously

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
- **Database**: PostgreSQL with PostGIS (external)
