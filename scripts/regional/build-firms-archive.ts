/**
 * CLI for build-firms-archive.sh: streams the downloaded yearly FIRMS CSVs through aggregate.ts
 * and writes firms-archive.<lastYear>.json and firms-static-cells.<lastYear>.json.
 *
 *   tsx build-firms-archive.ts --boundaries <dir> --csv <dir> --out <dir> [--first 2019] [--last 2024]
 *
 * CSV files are expected as <csv dir>/viirs-snpp_<year>_Russian_Federation.csv.
 * Exits 1 (and writes nothing) when validation fails.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { pickNewestRegionsFile } from '../../backend/services/firmsHistory/regions';
import { addCsvLines, ArchiveAccumulator, archiveRegions, validateOutputs, yearRange } from './aggregate';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const boundariesDir = arg('boundaries');
  const csvDir = arg('csv');
  const outDir = arg('out');
  const years = yearRange(Number(arg('first', '2019')), Number(arg('last', '2024')));
  const lastYear = years[years.length - 1];

  const boundaries = pickNewestRegionsFile(fs.readdirSync(boundariesDir));
  if (!boundaries) throw new Error(`ru-regions.*.geojson not found in ${boundariesDir}`);
  const regions = archiveRegions(JSON.parse(fs.readFileSync(path.join(boundariesDir, boundaries), 'utf8')));
  console.log(`boundaries: ${boundaries}, ${regions.length} regions`);

  const acc = new ArchiveAccumulator(regions, years);
  for (const year of years) {
    const file = path.join(csvDir, `viirs-snpp_${year}_Russian_Federation.csv`);
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    const rows = await addCsvLines(acc, lines);
    console.log(`${year}: ${rows} rows`);
  }

  const now = new Date();
  const outputs = {
    [`firms-archive.${lastYear}.json`]: JSON.stringify(acc.archive(now)),
    [`firms-static-cells.${lastYear}.json`]: JSON.stringify(acc.staticCells(now)),
  };
  const gzip = Object.fromEntries(Object.entries(outputs).map(([name, text]) => [name, zlib.gzipSync(text, { level: 9 }).length]));

  const archive = acc.archive(now);
  console.log('\nregion      ' + years.map(y => String(y).padStart(8)).join('') + '   (vegetation detections)');
  for (const [iso, r] of Object.entries(archive.regions)) {
    console.log(iso.padEnd(12) + years.map(y => String(r.years[String(y)].vegetation).padStart(8)).join('') + `   ${r.name}`);
  }
  const totals = years.map(y => Object.values(archive.regions).reduce((s, r) => {
    const c = r.years[String(y)];
    return { v: s.v + c.vegetation, s: s.s + c.static, o: s.o + c.offshore };
  }, { v: 0, s: 0, o: 0 }));
  years.forEach((y, i) => console.log(`${y}: vegetation ${totals[i].v}, static ${totals[i].s}, offshore ${totals[i].o}`));
  console.log(`rows ${acc.stats.rows}, outside regions (dropped) ${acc.stats.outsideRegions}, volcano ${acc.stats.volcano}, `
    + `outside years ${acc.stats.outsideYears}, malformed ${acc.stats.malformed}, other type ${acc.stats.otherType}`);
  console.log(`static cells (${acc.staticYears.size} years): ${acc.staticCells(now).cells.length}`);

  const problems = validateOutputs(archive, gzip);
  for (const [name, text] of Object.entries(outputs)) {
    console.log(`${name}  raw=${Math.round(text.length / 1024)}KB  gzip=${Math.round(gzip[name] / 1024)}KB`);
  }
  if (problems.length) {
    for (const p of problems) console.log(`FAIL: ${p}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(outDir, name), text + '\n');
  console.log(`OK: ${Object.keys(outputs).join(', ')} written to ${outDir}`);
}

main().catch(err => {
  console.error(`FAIL: ${err?.message ?? err}`);
  process.exit(1);
});
