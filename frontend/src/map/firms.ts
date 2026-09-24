/**
 * NASA FIRMS VIIRS hotspots: pure helpers shared by the Leaflet layer and tests.
 */

export type FirmsRegion = 'baikal' | 'russia';

export interface HotspotProps {
  satellite: string;
  acq_date: string;
  acq_time?: string;
  frp: number | string;
  brightness: number | string;
  confidence: string;
}

/** Irkutsk Oblast, Buryatia and Zabaykalsky Krai (west, south, east, north). */
const BAIKAL_BBOX = [95, 48, 122.5, 65];

const SATELLITES: Record<string, string> = {
  N: 'Suomi NPP VIIRS',
  N20: 'NOAA-20 VIIRS',
  N21: 'NOAA-21 VIIRS',
};

const CONFIDENCE: Record<string, string> = { high: 'высокая', nominal: 'средняя', low: 'низкая' };

export function firmsUrl(region: FirmsRegion): string {
  const base = '/api/monitoring/fire-hotspots/firms';
  return region === 'baikal' ? `${base}?bbox=${BAIKAL_BBOX.join(',')}` : base;
}

export function hotspotStyle(confidence: string) {
  const high = confidence === 'high';
  return {
    radius: high ? 5 : 3.5,
    color: '#fbbf24',
    weight: high ? 1.5 : 1,
    fillColor: '#ef4444',
    fillOpacity: high ? 0.95 : 0.75,
  };
}

export function describeHotspot(p: HotspotProps): { title: string; rows: Array<[string, string]> } {
  const time = p.acq_time && /^\d{4}$/.test(p.acq_time) ? ` ${p.acq_time.slice(0, 2)}:${p.acq_time.slice(2)}` : '';
  return {
    title: 'Термоточка FIRMS',
    rows: [
      ['Спутник', SATELLITES[p.satellite] ?? p.satellite],
      ['Дата', `${p.acq_date}${time} UTC`],
      ['FRP', `${Number(p.frp).toFixed(1)} МВт`],
      ['Яркость', `${Number(p.brightness).toFixed(0)} K`],
      ['Достоверность', CONFIDENCE[p.confidence] ?? p.confidence],
    ],
  };
}
