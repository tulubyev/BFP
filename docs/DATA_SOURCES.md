# Data Sources — практические заметки

Особенности внешних источников данных, выясненные при разработке.

## NASA FIRMS — публичный NRT CSV (без API-ключа)

URLs (updated ~3h, covers 24h detections):
- SNPP VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
- NOAA-20 VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv

Filter Russia: lat 40-82, lon 19-190. ~3500-5500 hotspots/24h.
Cache 1h server-side. Deduplicate by 0.01° grid.
**Why:** NASA FIRMS free API registration is required for authenticated endpoints, but public CSVs require no key.

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

Use area-based query (not bbox):
```
[out:json][timeout:60];
area["ISO3166-1"="RU"][admin_level="2"]->.russia;
(
  relation(area.russia)["boundary"="national_park"]["name"];
  relation(area.russia)["boundary"="protected_area"]["protect_class"="1"]["name"];
);
out tags center qt;
```
Returns ~150 Russian ООПТ. Bbox [41,19,82,180] returns ~445 but includes Balkans, Baltic states (they have Russian name translations in OSM).

POST format: URLSearchParams body (not encodeURIComponent), lon must be ≤ 180.
**Why:** bbox includes countries with Russian-language Wikipedia names in OSM. Area filter uses Russia's administrative boundary.
Note: Crimea/occupied territories appear because OSM area includes them.
