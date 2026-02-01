import { apiClient } from './client';
import type { ApiResponse } from '../types';
import { stub, todo } from '../utils/devAlerts';

export interface TileInfo {
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  center: [number, number, number];
}

export interface CogStatistics {
  min: number;
  max: number;
  mean: number;
  stddev: number;
  histogram: [number[], number[]];
}

export async function getCogInfo(url: string): Promise<ApiResponse<TileInfo>> {
  stub('getCogInfo', 'api/titiler.ts');
  return apiClient.get<TileInfo>(`titiler/cog/info?url=${encodeURIComponent(url)}`);
}

export async function getCogStatistics(url: string): Promise<ApiResponse<CogStatistics>> {
  stub('getCogStatistics', 'api/titiler.ts');
  return apiClient.get<CogStatistics>(`titiler/cog/statistics?url=${encodeURIComponent(url)}`);
}

export function getTileUrl(url: string, z: number, x: number, y: number): string {
  todo('getTileUrl: Add support for custom color maps and rescaling');
  return `/api/titiler/cog/tiles/${z}/${x}/${y}?url=${encodeURIComponent(url)}`;
}

export async function getPreview(_url: string, _width = 256, _height = 256): Promise<ApiResponse<Blob>> {
  stub('getPreview', 'api/titiler.ts');
  todo('getPreview: Implement preview generation with custom dimensions');
  
  return {
    success: false,
    error: 'Not implemented: getPreview needs blob handling',
  };
}

export default { getCogInfo, getCogStatistics, getTileUrl, getPreview };
