import { datasetDateFromPath, latestDatasetModified } from '../../backend/services/rosleskhozService';

describe('datasetDateFromPath', () => {
  it('extracts the modified date from a data-YYYYMMDDT... path', () => {
    const path = '/opendata/7705598840-WoodVolume/data-20260427T0000structure-20260427T0000.csv';
    expect(datasetDateFromPath(path)?.toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });

  it('returns null when the path has no dated data segment', () => {
    expect(datasetDateFromPath('/opendata/7705598840-WoodVolume/structure-20260427T0000.csv')).toBeNull();
    expect(datasetDateFromPath('')).toBeNull();
  });
});

describe('latestDatasetModified', () => {
  it('returns the newest date among all datasets known so far', () => {
    // Without any dynamic resolution (no network in tests), this falls back to the dates
    // encoded in the static DATASETS filenames declared in the service.
    const latest = latestDatasetModified();
    expect(latest).not.toBeNull();
    expect(latest!.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
  });
});
