# Data Sources — практические заметки

Особенности внешних источников данных, выясненные при разработке.

## NASA FIRMS — публичный NRT CSV (без API-ключа)

URLs (updated ~3h, covers 24h detections):
- SNPP VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
- NOAA-20 VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv

Filter Russia: lat 40-82, lon 19-190. ~3500-5500 hotspots/24h.
Cache 1h server-side. Deduplicate by 0.01° grid.
**Why:** NASA FIRMS free API registration is required for authenticated endpoints, but public CSVs require no key.

## NASA FIRMS — история и инциденты-пожары (задача #11)

- После каждого успешного обновления FIRMS (раз в 30 мин) весь снимок России пишется в
  `gis.fire_hotspots` (source `firms_viirs_nrt`), без дублей: уникальный индекс наблюдения из
  миграции `011_firms_history.sql`. Без миграции запись не выполняется, в журнале `firms_history`
  (`/api/sources/status` → `firms.historyJournal`) — «migration 011 not applied».
- Инциденты: только RU-IRK, RU-BU, RU-ZAB (point-in-polygon по `ru-regions.<версия>.geojson`),
  окно 72 ч, кластер — цепочка точек ≤ 2 км; событие — ≥ 2 точек или 1 точка высокой достоверности.
  `gis.forest_changes`: `source 'firms'`, `metadata.method 'firms-cluster-v1'`, статус «затих»
  через 48 ч без новых точек.
- **Площадь — оценка сверху**: число различных ячеек 375 м × 14,06 га. Пиксель VIIRS не означает,
  что выгорел весь пиксель; термоточка — не обязательно лесной пожар (палы, факелы, промышленность).
- Лицензия и атрибуция FIRMS — как у слоя термоточек (NASA, открытые данные).

## Global Forest Watch — авторизация и данные по России

The GFW Data API (data-api.globalforestwatch.org) requires an API key for ALL query endpoints. No public unauthenticated path exists.

**Adopted strategy:**
1. Embed verified published Hansen/UMD national totals as `RUSSIA_NATIONAL_LOSS_HA` constant in `globalForestWatch.ts` — from GFW annual Forest Pulse reports, not synthetic.
2. Regional distribution uses `REGION_LOSS_FRACTIONS` from Roslesinforg official forest inventory (average 2015–2022 proportions per region).
3. API response includes `data_type: 'published' | 'estimated'` and `data_source` string for UI labeling.
4. Frontend `DataBadge` shows green "Опубликованные данные" for national, yellow "Региональная оценка" for regional.

**Why:** GFW API requires registered key; World Bank API has net forest area (FAO) not gross loss; embedding verified published values is standard when live API auth is unavailable.

**How to apply:** If GFW API key available (env var `GFW_API_KEY`), the existing `getTreeCoverLoss()` already calls the real API. Regional method can be updated to call the real ADM1 endpoint.

## ООПТ — запрос к Overpass API

Use area-based query (not bbox), requesting full geometry via `out geom` (v2, 2026-09-24 — see
below for the earlier points-only version):
```
[out:json][timeout:180];
area["ISO3166-1"="RU"][admin_level="2"]->.russia;
(
  relation(area.russia)["boundary"="national_park"]["name"];
  relation(area.russia)["boundary"="protected_area"]["protect_class"="1"]["name"];
);
out geom qt;
```
Returns ~150 Russian ООПТ. Bbox [41,19,82,180] returns ~445 but includes Balkans, Baltic states (they have Russian name translations in OSM).

POST format: URLSearchParams body (not encodeURIComponent), lon must be ≤ 180.
**Why:** bbox includes countries with Russian-language Wikipedia names in OSM. Area filter uses Russia's administrative boundary.
Note: Crimea/occupied territories appear because OSM area includes them.

**Polygons, not points (2026-09-24):** `out geom` embeds each way member's coordinates directly
in the relation's `members` array — no separate `(._;>;)` recursion query needed. Ring assembly
(stitching way segments sharing endpoints into closed rings, matching inner rings/holes to their
outer ring) is hand-rolled in `backend/utils/osmRings.ts` rather than pulling in `osmtogeojson`,
since it's the only thing needed for these two relation types. Polygons are simplified server-side
(`backend/utils/geoSimplify.ts`) to keep the ~150-feature response under ~1.5 MB gzipped: adaptive
Douglas-Peucker (`@turf/simplify`) doubling the tolerance until a per-ring vertex cap is met, a
hard decimation fallback if that still isn't enough, and 5-decimal coordinate truncation. A
relation whose members don't have enough geometry to form a ring at all (degraded OSM data) falls
back to a centroid Point instead of being dropped. Redis key bumped `oopt:ru` → `oopt:ru:v2` so an
old points-shaped cache entry is never served as if it were polygons.

Use `@turf/simplify`/`@turf/truncate`/`@turf/area`/`@turf/point-on-feature` directly, not the
`@turf/turf` bundle — the bundle re-exports `@turf/convex`, which requires the ESM-only
`concaveman` package and crashes Node's CJS `require` (and ts-jest) the moment anything imports
`@turf/turf`. Nothing in this codebase had imported the bundle before, so this had never surfaced.

**Not verified live:** outbound network to `overpass-api.de` is blocked in the sandbox this was
written in, so the `out geom` query and ring-assembly logic were only exercised against a small
hand-built fixture matching the documented response shape, not a real Overpass response. Check
`GET /api/external/oopt` after deploy — `geojson.features[].geometry.type` should be
`Polygon`/`MultiPolygon` for ordinary reserves, not just `Point`.

## GFW tile layers (потери леса, DIST-ALERT, лесной покров) — итоговый набор (задача #2)

Separate from the national/regional loss numbers above: `/tiles/gfw/{loss,dist,cover}/{z}/{x}/{y}.png`
proxies GFW's raster tiles through the backend (`backend/services/gfwTiles.ts`).

- **Потери леса (Hansen/UMD), v1.13 (2001–2025):** tiles are data-encoded, not colored —
  `B = year − 2000`, `R` = loss intensity within the pixel. GFW's own web app colors them in
  WebGL; here `backend/utils/gfwDecode.ts` decodes and colors them server-side with `sharp`
  (amber for older loss → red for the most recent year) before caching the rendered PNG in Redis.
  512 px source tiles, so the Leaflet layer uses `tileSize: 512, zoomOffset: -1`.
  License: CC BY 4.0 (Hansen/UMD/Google/USGS/NASA).
- **DIST-ALERT (UMD GLAD):** replaced the old GLAD Landsat alerts layer, which returned 422 and
  didn't cover Russia. Data-encoded the same way (`R·255+G` = days since 2020-12-31, `B` =
  confidence·100 + intensity), decoded server-side the same way as loss tiles. **Retention: only
  the last ~2 years** — this is GFW's own rolling window for the dataset, not a limitation we
  impose; older disturbances are only visible through the Hansen/UMD loss layer once GFW folds
  them into a future annual `v1.x` release. License: CC BY 4.0 via GFW/UMD.
- **Лесной покров (Hansen/UMD, `umd_tree_cover_density_2000`):** static baseline, ≥30% canopy
  cover as of 2000. License: CC BY 4.0.
- Rendered tiles are cached in Redis with a per-layer `Cache-Control`/TTL (loss: 30 days,
  DIST-ALERT: 1 day, matching how often each dataset actually changes upstream); once `CDN_URL` is
  enabled the CDN caches them again at the edge.

## Basemaps

- **Default: Esri World Dark Gray** (`server.arcgisonline.com/.../World_Dark_Gray_Base`). CARTO's
  free dark basemap (`{s}.basemaps.cartocdn.com/dark_all/...`), used previously, now requires a
  registered API key and returns "API KEY REQUIRED" tiles without one — switched the default away
  from it rather than embed a key.
- Alternates in the layer switcher: OpenStreetMap standard tiles, Esri World Imagery (satellite).
- None of the three basemaps are proxied through the CDN — their terms of use prohibit a caching
  proxy in front of them, and they're already fast from within Russia.

## ФГИС ЛК — статус (проверено 2026-09-24)

The old public WMS endpoint documented for this project,
`https://pub.fgislk.gov.ru/plk/geoservermaster/geoserver/ows`, no longer behaves as a WMS: a
`GetCapabilities` request now returns the FGIS LK web application (HTML) instead of WMS XML, and
the server presents a certificate issued by a Russian Trusted CA (Минцифры) that mainstream
browsers (Chrome, Firefox, Safari) don't trust by default — so even a correct WMS response
wouldn't render as an `<img>`/`WMSTileLayer` in a typical visitor's browser. The layer is not
wired into the map for this reason (matches `future.md` §8's "if the source is unstable, the
layer must be off by default").

**Search for a replacement public endpoint:** direct verification wasn't possible — outbound
network to `*.gov.ru` and to `gis-lab.info` (a GIS community forum with relevant discussion) is
blocked in the sandbox this was researched from, so only web-search result snippets were
available, not the pages themselves. Those snippets point at:
- `pub.fgislk.gov.ru/map/` — a "Публичная лесная карта" (public forest map) module;
- `pub.fgislk.gov.ru/map/geo/geoserver/{wms,wfs}` — a GeoServer WMS/WFS path different from the
  one above;
- `pub5.fgislk.gov.ru/plk/gwc/geow` — vector tiles via GeoWebCache;
- a GIS-Lab.info forum thread literally titled "Как открыть WMS ФГИС ЛК?" ("How do I get the FGIS
  LK WMS open?"), whose existence suggests getting a working public WMS response out of this
  system is a known point of friction for third-party clients, not just for us.

**Verified from the production VPS (Russia) on 2026-09-25** — none of these is a usable public
endpoint:
- `pub.fgislk.gov.ru/map/geo/geoserver/wms?…GetCapabilities` → **403 Forbidden**; `…/wfs` → 403;
  `…/ows` → 404. The GeoServer exists but refuses anonymous clients; we do not spoof the FGIS
  web app's headers to get around an access control.
- `pub5.fgislk.gov.ru/plk/gwc/geow` → 404.
- `pub.fgislk.gov.ru/map/` → 200, the public forest map web application (HTML), not a service.
- The old `…/plk/geoservermaster/geoserver/ows` → 200 HTML (web app), not WMS.

Conclusion: no public WMS/WMTS/vector-tile endpoint is available; a ФГИС ЛК layer would need an
official data agreement or API access from Рослесхоз. Until
then, ФГИС ЛК stays undocumented as a working layer and OpenTopoMap (also removed per the
2026-09-24 map design, see `docs/superpowers/specs/2026-09-24-cdn-redis-map-design.md`) is not
brought back either.
