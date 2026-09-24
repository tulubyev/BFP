// Picks Russian regions (admin_level 4, ISO3166-2 RU-*) and the municipal districts
// (admin_level 6) of the Baikal regions out of an `osmium export` GeoJSON-seq file.
// Usage: node select.mjs <in.geojsonseq> <out-dir>
import fs from 'node:fs';
import readline from 'node:readline';
import * as turf from '@turf/turf';

const [input, outDir] = process.argv.slice(2);
const BAIKAL_REGIONS = ['RU-IRK', 'RU-BU', 'RU-ZAB'];
const EXPECTED_REGIONS = 83;
// Rough envelope of the three Baikal regions — cheap pre-filter before point-in-polygon
const BAIKAL_BBOX = { west: 95, south: 48, east: 122.5, north: 65 };

const regions = [];
const level6 = [];

function firstCoord(geometry) {
  let c = geometry.coordinates;
  while (Array.isArray(c[0])) c = c[0];
  return c;
}

const lines = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
for await (const raw of lines) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  const f = JSON.parse(line);
  const p = f.properties || {};
  if (p['@type'] !== 'relation' || p.boundary !== 'administrative') continue;
  if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue;

  if (p.admin_level === '4' && /^RU-/.test(p['ISO3166-2'] || '')) {
    regions.push(f);
  } else if (p.admin_level === '6') {
    const [lon, lat] = firstCoord(f.geometry);
    if (lon >= BAIKAL_BBOX.west && lon <= BAIKAL_BBOX.east && lat >= BAIKAL_BBOX.south && lat <= BAIKAL_BBOX.north) {
      level6.push(f);
    }
  }
}

function labelPoint(feature) {
  // pointOnFeature is guaranteed to fall inside the polygon (a centroid may not)
  const pt = turf.pointOnFeature(feature).geometry.coordinates;
  return [Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))];
}

const regionOut = regions.map(f => {
  const p = f.properties;
  return {
    type: 'Feature',
    properties: {
      osm_id: p['@id'],
      name: p['name:ru'] || p.name,
      iso: p['ISO3166-2'],
      kind: 'region',
      label: labelPoint(f),
    },
    geometry: f.geometry,
  };
});

const baikal = regionOut.filter(r => BAIKAL_REGIONS.includes(r.properties.iso));
const baikalGeoms = new Map(regions.filter(f => BAIKAL_REGIONS.includes(f.properties['ISO3166-2'])).map(f => [f.properties['ISO3166-2'], f]));

const districtOut = [];
for (const f of level6) {
  const inside = turf.pointOnFeature(f);
  const parent = baikal.find(r => turf.booleanPointInPolygon(inside, baikalGeoms.get(r.properties.iso)));
  if (!parent) continue;
  const p = f.properties;
  districtOut.push({
    type: 'Feature',
    properties: {
      osm_id: p['@id'],
      name: p['name:ru'] || p.name,
      kind: 'district',
      parent: parent.properties.name,
      parent_iso: parent.properties.iso,
      label: labelPoint(f),
    },
    geometry: f.geometry,
  });
}

// ── Validation ──
const errors = [];
if (regionOut.length !== EXPECTED_REGIONS) errors.push(`expected ${EXPECTED_REGIONS} regions, got ${regionOut.length}`);
for (const iso of BAIKAL_REGIONS) {
  const n = districtOut.filter(d => d.properties.parent_iso === iso).length;
  console.log(`${iso}: ${n} districts`);
  if (n === 0) errors.push(`no districts for ${iso}`);
}
if (errors.length) {
  console.error('Validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/regions.raw.geojson`, JSON.stringify({ type: 'FeatureCollection', features: regionOut }));
fs.writeFileSync(`${outDir}/districts.raw.geojson`, JSON.stringify({ type: 'FeatureCollection', features: districtOut }));
console.log(`regions: ${regionOut.length}, districts: ${districtOut.length}`);
