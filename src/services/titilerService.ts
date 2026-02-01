import axios, { AxiosInstance } from 'axios';
import titilerConfig from '../config/titiler';

export interface TileRequest {
  url: string; // COG URL
  expression?: string; // Band math expression
  colormap?: string; // Colormap name
  rescale?: string; // Rescaling range
}

export class TiTilerService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: titilerConfig.baseUrl,
      timeout: titilerConfig.timeout,
    });
  }

  /**
   * Get information about a COG file
   */
  async getInfo(cogUrl: string): Promise<any> {
    try {
      const response = await this.client.get('/cog/info', {
        params: { url: cogUrl }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get COG info: ${error}`);
    }
  }

  /**
   * Get tile URL for a COG file with optional processing
   */
  getTileUrl(request: TileRequest): string {
    const params = new URLSearchParams({
      url: request.url
    });

    if (request.expression) {
      params.append('expression', request.expression);
    }

    if (request.colormap) {
      params.append('colormap_name', request.colormap);
    }

    if (request.rescale) {
      params.append('rescale', request.rescale);
    }

    return `${titilerConfig.baseUrl}/cog/tiles/{z}/{x}/{y}?${params.toString()}`;
  }

  /**
   * Get statistics for a COG file
   */
  async getStatistics(cogUrl: string, expression?: string): Promise<any> {
    try {
      const params: any = { url: cogUrl };
      if (expression) {
        params.expression = expression;
      }

      const response = await this.client.get('/cog/statistics', { params });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get COG statistics: ${error}`);
    }
  }

  /**
   * Get a preview image of a COG file
   */
  async getPreview(cogUrl: string, width: number = 512): Promise<Buffer> {
    try {
      const response = await this.client.get('/cog/preview', {
        params: { url: cogUrl, width },
        responseType: 'arraybuffer'
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get COG preview: ${error}`);
    }
  }
}

export default new TiTilerService();