---
name: ООПТ Overpass query
description: Correct Overpass API query to get Russian protected areas without non-Russian false positives
---
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
