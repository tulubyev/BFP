import { describeHotspot, firmsUrl, hotspotStyle, type HotspotProps } from '../frontend/src/map/firms';

const hotspot: HotspotProps = {
  satellite: 'N21',
  acq_date: '2026-09-23',
  acq_time: '0428',
  frp: 21.47,
  brightness: 367,
  confidence: 'high',
};

describe('firmsUrl', () => {
  it('limits the default layer to the Baikal regions', () => {
    expect(firmsUrl('baikal')).toBe('/api/monitoring/fire-hotspots/firms?bbox=95,48,122.5,65');
  });

  it('asks for all of Russia without a bbox', () => {
    expect(firmsUrl('russia')).toBe('/api/monitoring/fire-hotspots/firms');
  });
});

describe('hotspotStyle', () => {
  it('draws high-confidence hotspots larger', () => {
    expect(hotspotStyle('high').radius).toBeGreaterThan(hotspotStyle('nominal').radius);
  });
});

describe('describeHotspot', () => {
  it('names the satellite and formats time and values', () => {
    expect(describeHotspot(hotspot).rows).toEqual([
      ['Спутник', 'NOAA-21 VIIRS'],
      ['Дата', '2026-09-23 04:28 UTC'],
      ['FRP', '21.5 МВт'],
      ['Яркость', '367 K'],
      ['Достоверность', 'высокая'],
    ]);
  });

  it('maps N to Suomi NPP and keeps unknown codes as-is', () => {
    expect(describeHotspot({ ...hotspot, satellite: 'N' }).rows[0][1]).toBe('Suomi NPP VIIRS');
    expect(describeHotspot({ ...hotspot, satellite: 'X9' }).rows[0][1]).toBe('X9');
  });
});
