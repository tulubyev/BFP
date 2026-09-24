import { latestDataPath } from '../../backend/services/rosleskhozService';

const META = `property,value
identifier,"7705598840-WoodVolume"
modified,20260427T0000
data-20240418T0000structure-20240418T0000,http://rosleshoz.gov.ru/opendata/7705598840-WoodVolume/data-20240418T0000structure-20240418T0000.csv
data-20260427T0000structure-20260427T0000,http://rosleshoz.gov.ru/opendata/7705598840-WoodVolume/data-20260427T0000structure-20260427T0000.csv
structure-20260427T0000,http://rosleshoz.gov.ru/opendata/7705598840-WoodVolume/structure-20260427T0000.csv
`;

describe('latestDataPath', () => {
  it('picks the newest data file regardless of line order', () => {
    expect(latestDataPath(META)).toBe('/opendata/7705598840-WoodVolume/data-20260427T0000structure-20260427T0000.csv');
  });

  it('returns null when meta.csv lists no data files', () => {
    expect(latestDataPath('property,value\nidentifier,"x"\n')).toBeNull();
  });

  it('ignores links to other hosts', () => {
    expect(latestDataPath('data-20260101T0000structure-20260101T0000,http://evil.example/opendata/x/data.csv\n')).toBeNull();
  });
});
