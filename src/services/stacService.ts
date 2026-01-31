import axios, { AxiosInstance } from 'axios';

export interface StacSearchParams {
  collections?: string[];
  bbox?: [number, number, number, number];
  datetime?: string;
  limit?: number;
  query?: Record<string, any>;
}

export interface StacItem {
  id: string;
  geometry: any;
  properties: {
    datetime: string;
    [key: string]: any;
  };
  assets: Record<string, {
    href: string;
    type: string;
    title?: string;
  }>;
}

export class StacService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = process.env.STAC_API_URL || 'http://localhost:8080') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  /**
   * Search for STAC items
   */
  async search(params: StacSearchParams): Promise<{ features: StacItem[] }> {
    try {
      const response = await this.client.post('/search', params);
      return response.data;
    } catch (error) {
      throw new Error(`STAC search failed: ${error}`);
    }
  }

  /**
   * Get a specific STAC item
   */
  async getItem(collectionId: string, itemId: string): Promise<StacItem> {
    try {
      const response = await this.client.get(`/collections/${collectionId}/items/${itemId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get STAC item: ${error}`);
    }
  }

  /**
   * Get collections available in the STAC API
   */
  async getCollections(): Promise<any[]> {
    try {
      const response = await this.client.get('/collections');
      return response.data.collections;
    } catch (error) {
      throw new Error(`Failed to get collections: ${error}`);
    }
  }

  /**
   * Search for Sentinel-2 scenes over Baikal region
   */
  async searchSentinel2(
    startDate: string, 
    endDate: string, 
    maxCloudCover: number = 20
  ): Promise<StacItem[]> {
    const params: StacSearchParams = {
      collections: ['sentinel-2-l2a'],
      bbox: [103.5, 51.4, 110.5, 56.0], // Baikal region
      datetime: `${startDate}/${endDate}`,
      limit: 100,
      query: {
        'eo:cloud_cover': {
          lt: maxCloudCover
        }
      }
    };

    const result = await this.search(params);
    return result.features;
  }

  /**
   * Search for Landsat scenes over Baikal region
   */
  async searchLandsat(
    startDate: string, 
    endDate: string, 
    maxCloudCover: number = 20
  ): Promise<StacItem[]> {
    const params: StacSearchParams = {
      collections: ['landsat-c2-l2'],
      bbox: [103.5, 51.4, 110.5, 56.0], // Baikal region
      datetime: `${startDate}/${endDate}`,
      limit: 100,
      query: {
        'eo:cloud_cover': {
          lt: maxCloudCover
        }
      }
    };

    const result = await this.search(params);
    return result.features;
  }
}

export default new StacService();