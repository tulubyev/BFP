import { apiClient } from './client';
import type { HealthResponse, ApiResponse } from '../types';

export async function checkHealth(): Promise<ApiResponse<HealthResponse>> {
  return apiClient.get<HealthResponse>('/health');
}

export default { checkHealth };
