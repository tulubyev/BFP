#!/usr/bin/env bash
# Daily health check of forestwatch.ru and its data sources (run by .github/workflows/health.yml).
# Prints one line per check; exits 1 if any check failed.
set -uo pipefail

SITE=https://forestwatch.ru
CDN=https://cdn.forestwatch.ru
failed=0
ok()   { echo "OK    $1"; }
fail() { echo "FAIL  $1"; failed=1; }

http_code() { curl -s -o /dev/null -m 60 --retry 2 --retry-all-errors -w '%{http_code}' "$@"; }

# ── Site, API (served from Redis) and tile proxy ──
[ "$(http_code "$SITE/health")" = 200 ] && ok "site /health" || fail "site /health"

oopt=$(curl -s -m 60 "$SITE/api/external/oopt" | jq -r '.count // 0' 2>/dev/null || echo 0)
[ "${oopt:-0}" -gt 0 ] && ok "OOPT: $oopt protected areas" || fail "OOPT: empty list"

firms=$(curl -s -m 60 "$SITE/api/monitoring/fire-hotspots/firms" | jq -r '.geojson.features | length' 2>/dev/null || echo 0)
[ "${firms:-0}" -gt 0 ] && ok "FIRMS: $firms hotspots (Russia, 24h)" || fail "FIRMS: no hotspots"

rosleshoz=$(curl -s -m 60 "$SITE/api/external/rosleshoz/summary" | jq -r '.success' 2>/dev/null)
[ "$rosleshoz" = true ] && ok "Rosleshoz summary" || fail "Rosleshoz summary"

for layer in loss dist cover; do
  size=$(curl -s -m 60 -o /dev/null -w '%{size_download}' "$SITE/tiles/gfw/$layer/7/102/41.png")
  # a transparent 1x1 fallback tile is ~70 bytes — real tiles here are larger
  [ "${size:-0}" -gt 200 ] && ok "GFW tile $layer (${size} B)" || fail "GFW tile $layer returned fallback (${size} B)"
done

# ── CDN serves the current bundle ──
asset=$(curl -s -m 30 "$SITE/" | grep -oE '/assets/index-[^"]+\.js' | head -1)
[ -n "$asset" ] && [ "$(http_code "$CDN$asset")" = 200 ] && ok "CDN $asset" || fail "CDN does not serve ${asset:-<no asset in index.html>}"

# ── TLS certificates: at least 14 days left ──
for host in forestwatch.ru cdn.forestwatch.ru; do
  end=$(echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -z "$end" ]; then fail "TLS $host: no certificate"; continue; fi
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  [ "$days" -ge 14 ] && ok "TLS $host: $days days left" || fail "TLS $host expires in $days days"
done

# ── Upstream freshness ──
lm=$(curl -sI -m 60 https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv | tr -d '\r' | grep -i '^last-modified:' | cut -d' ' -f2-)
if [ -n "$lm" ]; then
  hours=$(( ( $(date +%s) - $(date -d "$lm" +%s) ) / 3600 ))
  [ "$hours" -le 12 ] && ok "NASA FIRMS CSV updated ${hours}h ago" || fail "NASA FIRMS CSV stale: ${hours}h"
else
  fail "NASA FIRMS CSV unreachable"
fi

dist=$(curl -s -m 60 -o /dev/null -w '%{redirect_url}' "https://tiles.globalforestwatch.org/umd_glad_dist_alerts/latest/dynamic/0/0/0.png?implementation=default" | grep -oE 'v[0-9]{8}')
if [ -n "$dist" ]; then
  age=$(( ( $(date +%s) - $(date -d "${dist:1}" +%s) ) / 86400 ))
  [ "$age" -le 21 ] && ok "GFW DIST-ALERT $dist ($age days old)" || fail "GFW DIST-ALERT stale: $dist ($age days)"
else
  fail "GFW DIST-ALERT version not resolvable"
fi

exit $failed
