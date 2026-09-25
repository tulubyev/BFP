import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  completeYears, loadFirmsArchive, parseFirmsArchive, pickNewestArchiveFile,
} from '../../../backend/services/regions/firmsArchive';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/regional');
const fixture = () => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'firms-archive.2024.json'), 'utf8'));

describe('pickNewestArchiveFile', () => {
  it('picks the newest year and ignores other files', () => {
    expect(pickNewestArchiveFile(['firms-archive.2023.json', 'firms-static-cells.2025.json', 'firms-archive.2024.json']))
      .toBe('firms-archive.2024.json');
    expect(pickNewestArchiveFile(['firms-static-cells.2024.json', 'readme.md'])).toBeNull();
  });
});

describe('loadFirmsArchive', () => {
  it('reads the fixture in the spec format', () => {
    const archive = loadFirmsArchive([FIXTURE_DIR]);
    expect(archive?.file).toBe('firms-archive.2024.json');
    expect(archive?.years).toEqual([2019, 2020, 2021, 2022, 2023, 2024]);
    expect(archive?.regions['RU-IRK'].years['2024']).toEqual({ vegetation: 1500, static: 75, offshore: 0, frpVegetation: 15000 });
  });

  it('returns null when the archive has not been built (no file)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'regional-'));
    expect(loadFirmsArchive([empty, path.join(empty, 'missing')])).toBeNull();
  });

  it('returns null for a corrupt file instead of throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regional-'));
    fs.writeFileSync(path.join(dir, 'firms-archive.2024.json'), '{"years": [2024], "regions": ');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadFirmsArchive([dir])).toBeNull();
  });
});

describe('parseFirmsArchive', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));

  it('rejects a wrong shape', () => {
    expect(parseFirmsArchive('x', null)).toBeNull();
    expect(parseFirmsArchive('x', { ...fixture(), years: 'all' })).toBeNull();
    expect(parseFirmsArchive('x', { ...fixture(), regions: undefined })).toBeNull();
    expect(parseFirmsArchive('x', { ...fixture(), generatedAt: 'yesterday' })).toBeNull();
  });

  it('drops malformed year entries (they stay missing, not zero)', () => {
    const json = fixture();
    json.regions['RU-IRK'].years['2023'] = { vegetation: 'many', static: 1 };
    json.regions['RU-IRK'].years['2022'] = { vegetation: -5, static: 1 };
    const archive = parseFirmsArchive('f', json)!;
    expect(archive.regions['RU-IRK'].years['2023']).toBeUndefined();
    expect(archive.regions['RU-IRK'].years['2022']).toBeUndefined();
    expect(archive.regions['RU-IRK'].years['2024'].vegetation).toBe(1500);
  });

  it('sorts years', () => {
    expect(parseFirmsArchive('f', { ...fixture(), years: [2024, 2019, 2021] })!.years).toEqual([2019, 2021, 2024]);
  });
});

describe('completeYears', () => {
  it('keeps only years that ended before the file was generated', () => {
    expect(completeYears({ years: [2023, 2024, 2025, 2026], generatedAt: '2026-09-26T00:00:00Z' })).toEqual([2023, 2024, 2025]);
    expect(completeYears({ years: [2026], generatedAt: '2026-12-31T00:00:00Z' })).toEqual([]);
  });
});
