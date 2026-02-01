import axios from 'axios';

export interface GFWTreeCoverLoss {
  year: number;
  area_ha: number;
  emissions_Mg_CO2: number;
}

export interface GFWForestData {
  area_ha: number;
  tree_cover_extent_ha: number;
  tree_cover_loss_ha: number;
  tree_cover_gain_ha: number;
  primary_forest_loss_ha: number;
  emissions_Mt_CO2: number;
}

export interface GFWQueryParams {
  geostore?: string;
  geometry?: GeoJSON.Geometry;
  startYear?: number;
  endYear?: number;
}

export interface GFWConfig {
  apiKey?: string;
  baseUrl: string;
}

const DEFAULT_CONFIG: GFWConfig = {
  baseUrl: 'https://data-api.globalforestwatch.org'
};

const BAIKAL_GEOJSON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [100.0, 51.0],
    [112.0, 51.0],
    [112.0, 56.0],
    [100.0, 56.0],
    [100.0, 51.0]
  ]]
};

export class GlobalForestWatchService {
  private config: GFWConfig;

  constructor(config: Partial<GFWConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getTreeCoverLoss(params: GFWQueryParams): Promise<GFWTreeCoverLoss[]> {
    const { geometry = BAIKAL_GEOJSON, startYear = 2015, endYear = 2024 } = params;

    if (!this.config.apiKey) {
      console.warn('GFW API key not configured. Using sample data.');
      return this.getSampleTreeCoverLoss(startYear, endYear);
    }

    try {
      const response = await axios.post(
        `${this.config.baseUrl}/dataset/umd_tree_cover_loss/v1.9/query`,
        {
          geometry,
          sql: `SELECT umd_tree_cover_loss__year as year, 
                       SUM(area__ha) as area_ha,
                       SUM(whrc_aboveground_co2_emissions__Mg) as emissions_Mg_CO2
                FROM data 
                WHERE umd_tree_cover_loss__year >= ${startYear} 
                  AND umd_tree_cover_loss__year <= ${endYear}
                GROUP BY umd_tree_cover_loss__year
                ORDER BY year`
        },
        {
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('GFW API error:', error);
      return this.getSampleTreeCoverLoss(startYear, endYear);
    }
  }

  async getForestStatistics(geometry: GeoJSON.Geometry = BAIKAL_GEOJSON): Promise<GFWForestData> {
    if (!this.config.apiKey) {
      console.warn('GFW API key not configured. Using sample data.');
      return this.getSampleForestData();
    }

    try {
      const response = await axios.post(
        `${this.config.baseUrl}/dataset/gfw_forest_carbon_gross_emissions/latest/query`,
        { geometry },
        {
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const data = response.data.data?.[0] || {};
      return {
        area_ha: data.area__ha || 0,
        tree_cover_extent_ha: data.umd_tree_cover_extent_2000__ha || 0,
        tree_cover_loss_ha: data.umd_tree_cover_loss__ha || 0,
        tree_cover_gain_ha: data.umd_tree_cover_gain__ha || 0,
        primary_forest_loss_ha: data.umd_tree_cover_loss_from_fires__ha || 0,
        emissions_Mt_CO2: (data.gfw_forest_carbon_gross_emissions__Mg_CO2e || 0) / 1000000
      };
    } catch (error) {
      console.error('GFW API error:', error);
      return this.getSampleForestData();
    }
  }

  async getDeforestationAlerts(geometry: GeoJSON.Geometry = BAIKAL_GEOJSON, days: number = 30): Promise<any[]> {
    if (!this.config.apiKey) {
      console.warn('GFW API key not configured. Using sample data.');
      return this.getSampleAlerts();
    }

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const response = await axios.post(
        `${this.config.baseUrl}/dataset/gfw_integrated_alerts/latest/query`,
        {
          geometry,
          sql: `SELECT latitude, longitude, gfw_integrated_alerts__date, 
                       gfw_integrated_alerts__confidence
                FROM data 
                WHERE gfw_integrated_alerts__date >= '${startDate.toISOString().split('T')[0]}'
                  AND gfw_integrated_alerts__date <= '${endDate.toISOString().split('T')[0]}'
                LIMIT 1000`
        },
        {
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.data || [];
    } catch (error) {
      console.error('GFW Alerts API error:', error);
      return this.getSampleAlerts();
    }
  }

  private getSampleTreeCoverLoss(startYear: number, endYear: number): GFWTreeCoverLoss[] {
    const data: GFWTreeCoverLoss[] = [];
    const baseArea = 15000;
    
    for (let year = startYear; year <= endYear; year++) {
      const variation = (Math.random() - 0.5) * 0.4;
      const fireYear = [2019, 2021, 2023].includes(year) ? 1.8 : 1;
      const area = Math.round(baseArea * (1 + variation) * fireYear);
      
      data.push({
        year,
        area_ha: area,
        emissions_Mg_CO2: area * 150
      });
    }
    
    return data;
  }

  private getSampleForestData(): GFWForestData {
    return {
      area_ha: 25000000,
      tree_cover_extent_ha: 18500000,
      tree_cover_loss_ha: 285000,
      tree_cover_gain_ha: 120000,
      primary_forest_loss_ha: 45000,
      emissions_Mt_CO2: 42.5
    };
  }

  private getSampleAlerts(): any[] {
    const alerts = [];
    const today = new Date();
    
    for (let i = 0; i < 15; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - Math.floor(Math.random() * 30));
      
      alerts.push({
        latitude: 51.5 + Math.random() * 4.5,
        longitude: 100.5 + Math.random() * 11,
        date: date.toISOString().split('T')[0],
        confidence: Math.random() > 0.5 ? 'high' : 'medium'
      });
    }
    
    return alerts;
  }

  toGeoJSON(alerts: any[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: alerts.map(a => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [a.longitude, a.latitude]
        },
        properties: {
          date: a.date || a.gfw_integrated_alerts__date,
          confidence: a.confidence || a.gfw_integrated_alerts__confidence
        }
      }))
    };
  }
}

export const gfwService = new GlobalForestWatchService({
  apiKey: process.env.GFW_API_KEY
});

export const getGFWInfo = () => ({
  name: 'Global Forest Watch',
  url: 'https://www.globalforestwatch.org/',
  description: 'Online platform for monitoring forests worldwide using satellite data',
  datasets: [
    {
      name: 'Tree Cover Loss',
      source: 'University of Maryland',
      resolution: '30m',
      temporal: 'Annual (2001-present)'
    },
    {
      name: 'GLAD Alerts',
      source: 'Global Land Analysis & Discovery',
      resolution: '30m',
      temporal: 'Weekly'
    },
    {
      name: 'RADD Alerts',
      source: 'Radar for Detecting Deforestation',
      resolution: '10m',
      temporal: 'Every 6-12 days'
    }
  ],
  apiDocs: 'https://data-api.globalforestwatch.org/docs',
  baikalRegion: BAIKAL_GEOJSON
});
