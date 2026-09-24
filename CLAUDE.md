# CLAUDE.md — forestwatch.ru

Baikal forest-monitoring map: Express + TypeScript backend (`backend/`), React + Vite + Leaflet
frontend (`frontend/`), jest tests (`tests/`), PostgreSQL/PostGIS (tables in schema `gis`), Redis.
Production: https://forestwatch.ru. Background: `README.md`, `future.md` (roadmap and principles),
`docs/superpowers/specs/2026-09-24-cdn-redis-map-design.md`, `docs/DATA_SOURCES.md`.

The owner writes in Russian — answer in Russian. Code, comments and commit messages in English;
UI text in Russian.

## Checks (CI runs exactly these)

```bash
npm ci
npx tsc --noEmit -p .          # backend
npx tsc --noEmit -p frontend   # frontend (vite build does not type-check)
npx jest --ci
```

Local dev: backend `PORT=3000 npx ts-node -r tsconfig-paths/register backend/server.ts`;
frontend must run from its own dir (Tailwind config): `cd frontend && npx vite` (proxies `/api`,
`/tiles`, `/health` to :3000). Preview config: `.claude/launch.json`.

## Shipping

- A push to `main` **deploys to production**: `.github/workflows/ci.yml` runs the checks, then
  SSHes to the VPS with a key that the server restricts to `bash deploy.sh`, then smoke-tests.
- Tasks without explicit approval to ship: work on a branch and open a pull request; never push
  or merge to `main`.
- Never touch: the server `.env` (DB password, `CDN_URL`), anything needing `sudo` on the VPS,
  the Beget panel (DNS, CDN purge), `authorized_keys`, repo secrets. Ask the owner.
- Database migrations on `forest_db` only after the owner agrees — there is no staging database.
- Do not prune Docker images or build cache on the VPS (shared by other projects).
- `Проект_карты_убыли_лесов_Байкала.md` is the owner's local document — never commit it.

## Caching — easy to break

- `/assets/*` (hashed), `/data/boundaries/*.<YYYY-MM>.geojson` (versioned) and `/tiles/gfw/*` are
  cached for a long time by browsers **and Beget CDN** (`cdn.forestwatch.ru`). Never change such a
  file in place: new content needs a new name (boundaries: new version + `boundariesVersion.ts`).
- Redis (`backend/utils/cache.ts`): `cached()` / `warm()` keep `key:last-good`; an empty or invalid
  result must never replace good data. When a cached value changes shape, bump the key
  (`oopt:ru` → `oopt:ru:v2`). Background refresh lives in `backend/jobs/refresh.ts`.
- New external host in the browser → add it to the helmet CSP in `backend/server.ts`
  (`CDN_URL` is added automatically).

## Data principles (from future.md)

- No unlabeled demo/sample data anywhere users can see it. On failure show «нет данных» or the
  last good value **with its date**, never invented numbers.
- Every number has a source, license and date. Forest cover loss ≠ illegal logging.

## Code conventions

- Map features are modules in `frontend/src/map/`: pure helpers (tested in `tests/`) + a thin
  Leaflet file. Popups and labels are built with text nodes (`frontend/src/map/popup.ts`) —
  no `innerHTML` with data from APIs.
- New logic comes with jest tests; extract pure functions to make it testable.

## Gotchas

- GFW loss and DIST-ALERT tiles are data-encoded (year/date in RGB); `backend/utils/gfwDecode.ts`
  colors them server-side. Loss v1.13 = 2001–2025, 512 px tiles (`tileSize 512, zoomOffset -1`).
- CARTO basemaps return "API KEY REQUIRED" tiles → default basemap is Esri World Dark Gray.
- Overpass (`overpass-api.de`) needs a User-Agent, takes ~20 s and often answers 504.
- FIRMS satellite codes: `N` = Suomi NPP, `N20` = NOAA-20, `N21` = NOAA-21. Chukotka has
  negative longitudes — use `inBbox()` in `firmsService.ts`.
- npm 11 skips install scripts unless allowed: `sharp` is listed in `allowScripts` in `package.json`.
- Traefik routes only to healthy containers; the Dockerfile healthcheck polls every 2 s at start.
- Boundaries: `scripts/boundaries/build.sh` (Geofabrik + osmium + mapshaper); 83 regions
  without Crimea, Sevastopol and the 2022 regions — the owner's decision.
