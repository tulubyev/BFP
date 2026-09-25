#!/usr/bin/env bash
# Builds the regional NASA FIRMS archive (VIIRS S-NPP 375 m, yearly country CSVs for Russia, NASA
# open data) for regional analytics (#12, part A):
#   - firms-archive.<LAST>.json       per region and year: vegetation / static / offshore detections,
#                                     FRP sum of vegetation fires, region area (km², @turf/area)
#   - firms-static-cells.<LAST>.json  0.004° grid cells with type = 2 (static land source, gas flares)
#                                     in the last three years — used by the FIRMS incident flare mask
# Points outside the 83 regions of the newest ru-regions.*.geojson are dropped.
#
# Needs Docker and ~0.5 GB free disk. Downloads ~70 MB per year from firms.modaps.eosdis.nasa.gov.
# Usage: bash scripts/regional/build-firms-archive.sh [work-dir]     (FIRST=2019 LAST=2024 by default)
# Result: <work-dir>/out/firms-archive.<LAST>.json, firms-static-cells.<LAST>.json
# Copy them to frontend/public/data/regional/ (never overwrite a published file: new year = new name).
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPTS/../.." && pwd)"
WORK="${1:-$HOME/firms-archive-build}"
FIRST="${FIRST:-2019}"
LAST="${LAST:-2024}"
mkdir -p "$WORK/csv" "$WORK/out" "$WORK/deps"

echo "== 1/2 download yearly CSVs $FIRST-$LAST"
for year in $(seq "$FIRST" "$LAST"); do
  name="viirs-snpp_${year}_Russian_Federation.csv"
  if [ -s "$WORK/csv/$name" ]; then echo "$name: already downloaded"; continue; fi
  curl -fL --retry 3 -o "$WORK/csv/$name.part" \
    "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/$year/$name"
  mv "$WORK/csv/$name.part" "$WORK/csv/$name"
  echo "$name: $(( $(stat -c %s "$WORK/csv/$name") / 1024 / 1024 )) MB"
done

echo "== 2/2 aggregate by region (streamed) and validate"
# Run as the calling user so the work dir stays removable without sudo
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$REPO":/repo:ro -v "$WORK":/work -w /work/deps node:20-slim sh -c "
  set -e
  [ -x node_modules/.bin/tsx ] || { npm init -y >/dev/null && npm install --silent --no-audit --no-fund tsx@4 @turf/area@6.5.0 >/dev/null; }
  NODE_PATH=/work/deps/node_modules node_modules/.bin/tsx /repo/scripts/regional/build-firms-archive.ts \
    --boundaries /repo/frontend/public/data/boundaries --csv /work/csv --out /work/out --first $FIRST --last $LAST
"
echo "OK: copy $WORK/out/firms-*.$LAST.json to frontend/public/data/regional/. CSVs can be deleted: rm -rf $WORK"
