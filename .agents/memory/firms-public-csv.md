---
name: FIRMS public NRT CSV
description: NASA FIRMS fire hotspots available without API key via public CSV endpoints
---
URLs (updated ~3h, covers 24h detections):
- SNPP VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
- NOAA-20 VIIRS: https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv

Filter Russia: lat 40-82, lon 19-190. ~3500-5500 hotspots/24h.
Cache 1h server-side. Deduplicate by 0.01° grid.
**Why:** NASA FIRMS free API registration is required for authenticated endpoints, but public CSVs require no key.
