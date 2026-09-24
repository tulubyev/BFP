#!/usr/bin/env bash
# Builds simplified administrative boundaries from OpenStreetMap (© OSM contributors, ODbL).
#   - 83 regions of Russia (admin_level 4, ISO3166-2 RU-*)
#   - municipal districts (admin_level 6) of Irkutsk Oblast, Buryatia, Zabaykalsky Krai
#
# Needs Docker and ~6 GB free disk. Downloads russia-latest.osm.pbf (~4.2 GB) from Geofabrik.
# Usage: bash scripts/boundaries/build.sh [work-dir]
# Result: <work-dir>/out/ru-regions.<YYYY-MM>.geojson, baikal-districts.<YYYY-MM>.geojson
# Copy them to frontend/public/data/boundaries/ and update frontend/src/map/boundariesVersion.ts.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HOME/bnd-build}"
PBF_URL="https://download.geofabrik.de/russia-latest.osm.pbf"
BUDGET_GZIP_BYTES=$((300 * 1024))
mkdir -p "$WORK/out"
cd "$WORK"

echo "== 1/4 download $PBF_URL"
curl -fL -C - -o russia.osm.pbf "$PBF_URL"
VERSION=$(date -u -r russia.osm.pbf +%Y-%m)

echo "== 2/4 osmium: admin boundaries level 4 and 6 -> GeoJSON-seq"
docker run --rm -v "$WORK":/work -w /work debian:bookworm-slim sh -c '
  set -e
  apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null
  osmium tags-filter -O russia.osm.pbf r/boundary=administrative -o admin.osm.pbf
  osmium tags-filter -O admin.osm.pbf r/admin_level=4,6 -o admin46.osm.pbf
  osmium export -O admin46.osm.pbf --geometry-types=polygon --attributes=type,id -f geojsonseq -o admin46.geojsonseq
'

echo "== 3/4 select regions and Baikal districts"
docker run --rm -v "$WORK":/work -v "$SCRIPTS":/scripts:ro -w /work node:20-slim sh -c '
  set -e
  npm init -y >/dev/null && npm install --silent --no-audit --no-fund @turf/turf@6 mapshaper@0.6 >/dev/null
  cp /scripts/select.mjs ./select.mjs
  node --max-old-space-size=4096 select.mjs admin46.geojsonseq out
'

echo "== 4/4 simplify (topology-aware) and write versioned files"
docker run --rm -v "$WORK":/work -w /work node:20-slim sh -c "
  set -e
  npx --no-install mapshaper -i out/regions.raw.geojson -simplify 1.5% keep-shapes -clean \
    -o precision=0.0001 format=geojson out/ru-regions.$VERSION.geojson
  npx --no-install mapshaper -i out/districts.raw.geojson -simplify 6% keep-shapes -clean \
    -o precision=0.0001 format=geojson out/baikal-districts.$VERSION.geojson
"

total=0
for f in out/ru-regions.$VERSION.geojson out/baikal-districts.$VERSION.geojson; do
  raw=$(stat -c %s "$f"); gz=$(gzip -9c "$f" | wc -c); total=$((total + gz))
  echo "$f  raw=$((raw / 1024))KB  gzip=$((gz / 1024))KB"
done
if [ "$total" -gt "$BUDGET_GZIP_BYTES" ]; then
  echo "FAIL: gzip total $((total / 1024))KB exceeds budget $((BUDGET_GZIP_BYTES / 1024))KB — raise simplification"; exit 1
fi
echo "OK: version $VERSION, gzip total $((total / 1024))KB. Intermediate files can be deleted: rm -rf $WORK"
