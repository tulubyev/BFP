---
name: GFW API authentication and Russia forest data strategy
description: How to provide real Russian forest loss data when GFW API key is unavailable
---

The GFW Data API (data-api.globalforestwatch.org) requires an API key for ALL query endpoints. No public unauthenticated path exists.

**Adopted strategy:**
1. Embed verified published Hansen/UMD national totals as `RUSSIA_NATIONAL_LOSS_HA` constant in `globalForestWatch.ts` — from GFW annual Forest Pulse reports, not synthetic.
2. Regional distribution uses `REGION_LOSS_FRACTIONS` from Roslesinforg official forest inventory (average 2015–2022 proportions per region).
3. API response includes `data_type: 'published' | 'estimated'` and `data_source` string for UI labeling.
4. Frontend `DataBadge` shows green "Опубликованные данные" for national, yellow "Региональная оценка" for regional.

**Why:** GFW API requires registered key; World Bank API has net forest area (FAO) not gross loss; embedding verified published values is standard when live API auth is unavailable.

**How to apply:** If GFW API key available (env var `GFW_API_KEY`), the existing `getTreeCoverLoss()` already calls the real API. Regional method can be updated to call the real ADM1 endpoint.
