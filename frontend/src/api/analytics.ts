import { apiClient } from './client';
import type { ForestArea, ForestChange, ForestStatistics, ApiResponse } from '../types';
import { devAlert, AlertLevel } from '../utils/devAlerts';

export async function getForestAreas(bbox: [number, number, number, number]): Promise<ApiResponse<ForestArea[]>> {
  devAlert(AlertLevel.TODO, 'getForestAreas: Add caching and pagination', 'api/analytics.ts');
  return apiClient.get<ForestArea[]>(`analytics/areas?bbox=${bbox.join(',')}`);
}

export async function getForestChanges(
  startDate: string,
  endDate: string,
  forestAreaId?: number
): Promise<ApiResponse<ForestChange[]>> {
  devAlert(AlertLevel.TODO, 'getForestChanges: Add date validation and filtering', 'api/analytics.ts');
  
  let url = `analytics/changes?start=${startDate}&end=${endDate}`;
  if (forestAreaId) {
    url += `&forestAreaId=${forestAreaId}`;
  }
  return apiClient.get<ForestChange[]>(url);
}

export async function getForestStatistics(forestAreaId: number): Promise<ApiResponse<ForestStatistics>> {
  devAlert(AlertLevel.TODO, 'getForestStatistics: Add time range parameter', 'api/analytics.ts');
  return apiClient.get<ForestStatistics>(`analytics/statistics/${forestAreaId}`);
}

export default { getForestAreas, getForestChanges, getForestStatistics };
