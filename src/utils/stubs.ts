import { stub, todo } from './devAlerts';

export interface StubResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  isStub: true;
}

export function createStub<T>(name: string, defaultValue?: T): () => StubResult<T> {
  return () => {
    stub(name, 'stubs.ts');
    return {
      success: false,
      data: defaultValue,
      error: `${name} is not implemented yet`,
      isStub: true
    };
  };
}

export function notImplemented(featureName: string): never {
  todo(`Feature '${featureName}' needs implementation`);
  throw new Error(`Not implemented: ${featureName}`);
}

export const satelliteImageProcessing = {
  analyzeNDVI: createStub<number[]>('analyzeNDVI'),
  
  detectChanges: createStub<any[]>('detectChanges'),
  
  classifyForestType: createStub<string>('classifyForestType'),
  
  calculateBurnSeverity: createStub<number>('calculateBurnSeverity'),
};

export const mlPredictions = {
  predictFireRisk: createStub<number>('predictFireRisk'),
  
  predictDeforestation: createStub<any>('predictDeforestation'),
  
  classifyLandCover: createStub<string[]>('classifyLandCover'),
};

export const reportGeneration = {
  generatePDFReport: createStub<Buffer>('generatePDFReport'),
  
  generateExcelExport: createStub<Buffer>('generateExcelExport'),
  
  generateGeoJSON: createStub<object>('generateGeoJSON'),
};

export default {
  createStub,
  notImplemented,
  satelliteImageProcessing,
  mlPredictions,
  reportGeneration
};
