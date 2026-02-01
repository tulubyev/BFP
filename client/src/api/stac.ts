import { apiClient } from './client';
import type { ApiResponse, Geometry } from '../types';
import { stub, todo } from '../utils/devAlerts';

export interface StacCollection {
  id: string;
  title: string;
  description: string;
}

export interface StacItem {
  id: string;
  collection: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
  assets: Record<string, StacAsset>;
}

export interface StacAsset {
  href: string;
  type: string;
  title?: string;
}

export async function getCollections(): Promise<ApiResponse<StacCollection[]>> {
  stub('getCollections', 'api/stac.ts');
  return apiClient.get<StacCollection[]>('stac/collections');
}

export async function searchItems(params: {
  bbox?: [number, number, number, number];
  datetime?: string;
  collections?: string[];
}): Promise<ApiResponse<StacItem[]>> {
  stub('searchItems', 'api/stac.ts');
  todo('Implement STAC item search with proper query parameters');
  
  const queryParams = new URLSearchParams();
  if (params.bbox) queryParams.set('bbox', params.bbox.join(','));
  if (params.datetime) queryParams.set('datetime', params.datetime);
  if (params.collections) queryParams.set('collections', params.collections.join(','));
  
  return apiClient.get<StacItem[]>(`stac/search?${queryParams.toString()}`);
}

export async function getItem(collectionId: string, itemId: string): Promise<ApiResponse<StacItem>> {
  stub('getItem', 'api/stac.ts');
  return apiClient.get<StacItem>(`stac/collections/${collectionId}/items/${itemId}`);
}

export default { getCollections, searchItems, getItem };
