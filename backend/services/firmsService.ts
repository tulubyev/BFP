import axios from 'axios';
import { cached, warm } from '../utils/cache';

export interface FIRMSHotspot {
  latitude: number;
  longitude: number;
  brightness: number;
  bright_t31?: number;
  frp: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  version: string;
  daynight: string;
}

// east > 180 wraps past the antimeridian (Chukotka reports longitudes near -170)
const FIRMS_RUSSIA_BBOX = { west: 19, south: 40, east: 190, north: 82 };

type Bbox = { west: number; south: number; east: number; north: number };

const FIRMS_KEY = 'firms:viirs:ru';
const FIRMS_TTL_SEC = 2 * 60 * 60;
const nonEmpty = (hotspots: unknown[]) => hotspots.length > 0;

export function inBbox(lat: number, lon: number, bbox: Bbox): boolean {
  if (lat < bbox.south || lat > bbox.north) return false;
  const wrapped = bbox.east > 180 && lon < 0 ? lon + 360 : lon;
  return wrapped >= bbox.west && wrapped <= bbox.east;
}

export interface FIRMSQueryParams {
  source: 'VIIRS_SNPP_NRT' | 'VIIRS_NOAA20_NRT' | 'MODIS_NRT';
  country?: string;
  area?: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  dayRange?: number;
}

export interface FIRMSServiceConfig {
  apiKey?: string;
  baseUrl: string;
}

const BAIKAL_REGION_BBOX = {
  west: 100.0,
  south: 51.0,
  east: 112.0,
  north: 56.0
};

const DEFAULT_CONFIG: FIRMSServiceConfig = {
  baseUrl: 'https://firms.modaps.eosdis.nasa.gov/api'
};

export class FIRMSService {
  private config: FIRMSServiceConfig;

  constructor(config: Partial<FIRMSServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getHotspots(params: FIRMSQueryParams): Promise<FIRMSHotspot[]> {
    const { source, area = BAIKAL_REGION_BBOX, dayRange = 1 } = params;

    // Try public NRT CSV first (no API key required)
    try {
      return await this.getHotspotsFromPublicCSV(area);
    } catch (publicErr) {
      console.warn('FIRMS public CSV failed, trying authenticated API:', (publicErr as Error).message);
    }

    if (!this.config.apiKey) {
      console.warn('NASA FIRMS API key not configured and public CSV unavailable.');
      return [];
    }

    try {
      const mapKey = this.config.apiKey;
      const bbox = `${area.west},${area.south},${area.east},${area.north}`;
      const url = `${this.config.baseUrl}/area/csv/${mapKey}/${source}/${bbox}/${dayRange}`;
      const response = await axios.get(url, { timeout: 30000 });
      return this.parseCSV(response.data);
    } catch (error) {
      console.error('FIRMS API error:', error);
      throw new Error('Failed to fetch fire hotspots from NASA FIRMS');
    }
  }

  /**
   * Fetch from NASA FIRMS public NRT CSV (no API key required).
   * Source: https://firms.modaps.eosdis.nasa.gov/active_fire/
   * Updated every ~3 hours, covers 24 hours of detections.
   * The Russia-wide subset lives in Redis (refreshed every 30 min by jobs/refresh.ts);
   * `area` filters within it.
   */
  async getHotspotsFromPublicCSV(
    area: { west: number; south: number; east: number; north: number } = FIRMS_RUSSIA_BBOX
  ): Promise<FIRMSHotspot[]> {
    const russia = await cached(FIRMS_KEY, FIRMS_TTL_SEC, () => this._fetchRussiaHotspots(), { isValid: nonEmpty });
    return this._filterByBbox(russia, area);
  }

  refreshRussia(): Promise<boolean> {
    return warm(FIRMS_KEY, FIRMS_TTL_SEC, () => this._fetchRussiaHotspots(), { isValid: nonEmpty });
  }

  private async _fetchRussiaHotspots(): Promise<FIRMSHotspot[]> {
    const urls = [
      'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
      'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv',
      'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv',
    ];

    const results = await Promise.allSettled(
      urls.map(url => axios.get(url, { timeout: 25000, responseType: 'text' }))
    );

    const all: FIRMSHotspot[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        all.push(...this.parseCSV(r.value.data));
      }
    }

    if (all.length === 0) throw new Error('All public FIRMS CSV endpoints failed');

    // Deduplicate by proximity (same pixel detected by both satellites)
    return this._filterByBbox(this._deduplicateHotspots(all), FIRMS_RUSSIA_BBOX);
  }

  private _filterByBbox(
    hotspots: FIRMSHotspot[],
    bbox: { west: number; south: number; east: number; north: number }
  ): FIRMSHotspot[] {
    return hotspots.filter(h => inBbox(h.latitude, h.longitude, bbox));
  }

  private _deduplicateHotspots(hotspots: FIRMSHotspot[]): FIRMSHotspot[] {
    const grid = new Map<string, FIRMSHotspot>();
    for (const h of hotspots) {
      // 0.01° grid (~1km) to merge near-duplicate detections
      const key = `${(h.latitude * 100).toFixed(0)},${(h.longitude * 100).toFixed(0)}`;
      const existing = grid.get(key);
      if (!existing || h.frp > existing.frp) grid.set(key, h);
    }
    return Array.from(grid.values());
  }

  async getBaikalHotspots(dayRange: number = 7): Promise<FIRMSHotspot[]> {
    const viirs = await this.getHotspots({
      source: 'VIIRS_SNPP_NRT',
      area: BAIKAL_REGION_BBOX,
      dayRange
    });

    const modis = await this.getHotspots({
      source: 'MODIS_NRT',
      area: BAIKAL_REGION_BBOX,
      dayRange
    });

    return [...viirs, ...modis].sort((a, b) => 
      new Date(b.acq_date).getTime() - new Date(a.acq_date).getTime()
    );
  }

  async getActiveFiresCount(area = BAIKAL_REGION_BBOX): Promise<number> {
    const hotspots = await this.getHotspots({
      source: 'VIIRS_SNPP_NRT',
      area,
      dayRange: 1
    });
    return hotspots.filter(h => h.confidence === 'high' || h.confidence === 'nominal').length;
  }

  private parseCSV(csvData: string): FIRMSHotspot[] {
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const record: any = {};
      
      headers.forEach((header, i) => {
        record[header] = values[i]?.trim();
      });

      return {
        latitude: parseFloat(record.latitude),
        longitude: parseFloat(record.longitude),
        brightness: parseFloat(record.bright_ti4 || record.brightness),
        bright_t31: record.bright_ti5 ? parseFloat(record.bright_ti5) : undefined,
        frp: parseFloat(record.frp || '0'),
        scan: parseFloat(record.scan || '0'),
        track: parseFloat(record.track || '0'),
        acq_date: record.acq_date,
        acq_time: record.acq_time,
        satellite: record.satellite || 'VIIRS',
        confidence: record.confidence || 'nominal',
        version: record.version || '2.0',
        daynight: record.daynight || 'D'
      };
    });
  }

  private getSampleHotspots(): FIRMSHotspot[] {
    const today = new Date().toISOString().split('T')[0];
    return [
      {
        latitude: 54.32,
        longitude: 109.25,
        brightness: 320.5,
        frp: 15.8,
        scan: 0.39,
        track: 0.36,
        acq_date: today,
        acq_time: '1430',
        satellite: 'VIIRS',
        confidence: 'high',
        version: '2.0NRT',
        daynight: 'D'
      },
      {
        latitude: 55.12,
        longitude: 109.45,
        brightness: 340.1,
        frp: 25.6,
        scan: 0.42,
        track: 0.38,
        acq_date: today,
        acq_time: '1015',
        satellite: 'MODIS',
        confidence: 'high',
        version: '6.1NRT',
        daynight: 'D'
      },
      {
        latitude: 51.85,
        longitude: 105.32,
        brightness: 295.3,
        frp: 8.2,
        scan: 0.35,
        track: 0.33,
        acq_date: today,
        acq_time: '1345',
        satellite: 'VIIRS',
        confidence: 'nominal',
        version: '2.0NRT',
        daynight: 'D'
      }
    ];
  }

  toGeoJSON(hotspots: FIRMSHotspot[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: hotspots.map(h => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [h.longitude, h.latitude]
        },
        properties: {
          brightness: h.brightness,
          frp: h.frp,
          acq_date: h.acq_date,
          acq_time: h.acq_time,
          satellite: h.satellite,
          confidence: h.confidence,
          daynight: h.daynight
        }
      }))
    };
  }
}

export const firmsService = new FIRMSService({
  apiKey: process.env.NASA_FIRMS_API_KEY
});

export const getFIRMSInfo = () => ({
  name: 'NASA Fire Information for Resource Management System',
  url: 'https://firms.modaps.eosdis.nasa.gov/',
  description: 'Near real-time fire/hotspot data from MODIS and VIIRS',
  dataSources: [
    {
      name: 'MODIS',
      satellites: ['Terra', 'Aqua'],
      resolution: '1km',
      revisit: '1-2 days'
    },
    {
      name: 'VIIRS',
      satellites: ['Suomi NPP', 'NOAA-20'],
      resolution: '375m',
      revisit: '12 hours'
    }
  ],
  apiDocs: 'https://firms.modaps.eosdis.nasa.gov/api/data_availability/',
  baikalCoverage: BAIKAL_REGION_BBOX
});
