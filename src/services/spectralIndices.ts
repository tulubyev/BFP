export interface BandValues {
  blue?: number;
  green?: number;
  red: number;
  nir: number;
  swir1?: number;
  swir2?: number;
}

export interface IndexResult {
  value: number;
  classification: string;
  healthy: boolean;
}

export interface SentinelBands {
  B02?: number;  // Blue
  B03?: number;  // Green
  B04: number;   // Red
  B05?: number;  // Red Edge 1
  B06?: number;  // Red Edge 2
  B07?: number;  // Red Edge 3
  B08: number;   // NIR
  B8A?: number;  // NIR Narrow
  B11?: number;  // SWIR 1
  B12?: number;  // SWIR 2
}

export interface LandsatBands {
  B2?: number;  // Blue
  B3?: number;  // Green
  B4: number;   // Red
  B5: number;   // NIR
  B6?: number;  // SWIR 1
  B7?: number;  // SWIR 2
}

export class SpectralIndexCalculator {
  static ndvi(bands: BandValues): IndexResult {
    const { nir, red } = bands;
    if (nir + red === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = (nir - red) / (nir + red);
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifyNDVI(value),
      healthy: value >= 0.4
    };
  }

  static nbr(bands: BandValues): IndexResult {
    const { nir, swir2 } = bands;
    if (!swir2 || nir + swir2 === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = (nir - swir2) / (nir + swir2);
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifyNBR(value),
      healthy: value >= 0.2
    };
  }

  static ndwi(bands: BandValues): IndexResult {
    const { green, nir } = bands;
    if (!green || green + nir === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = (green - nir) / (green + nir);
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifyNDWI(value),
      healthy: value >= -0.3 && value <= 0.3
    };
  }

  static evi(bands: BandValues): IndexResult {
    const { blue, red, nir } = bands;
    if (!blue) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const L = 1;
    const C1 = 6;
    const C2 = 7.5;
    const G = 2.5;
    
    const denominator = nir + C1 * red - C2 * blue + L;
    if (denominator === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = G * ((nir - red) / denominator);
    const clampedValue = Math.max(-1, Math.min(1, value));
    
    return {
      value: Math.round(clampedValue * 10000) / 10000,
      classification: this.classifyEVI(clampedValue),
      healthy: clampedValue >= 0.3
    };
  }

  static savi(bands: BandValues, L: number = 0.5): IndexResult {
    const { nir, red } = bands;
    const denominator = nir + red + L;
    if (denominator === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = ((nir - red) / denominator) * (1 + L);
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifySAVI(value),
      healthy: value >= 0.3
    };
  }

  static ndmi(bands: BandValues): IndexResult {
    const { nir, swir1 } = bands;
    if (!swir1 || nir + swir1 === 0) {
      return { value: 0, classification: 'no_data', healthy: false };
    }
    
    const value = (nir - swir1) / (nir + swir1);
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifyNDMI(value),
      healthy: value >= 0.0
    };
  }

  static dNBR(nbrPre: number, nbrPost: number): IndexResult {
    const value = nbrPre - nbrPost;
    return {
      value: Math.round(value * 10000) / 10000,
      classification: this.classifyDNBR(value),
      healthy: value < 0.1
    };
  }

  static fromSentinel2(bands: SentinelBands): BandValues {
    return {
      blue: bands.B02,
      green: bands.B03,
      red: bands.B04,
      nir: bands.B08,
      swir1: bands.B11,
      swir2: bands.B12
    };
  }

  static fromLandsat(bands: LandsatBands): BandValues {
    return {
      blue: bands.B2,
      green: bands.B3,
      red: bands.B4,
      nir: bands.B5,
      swir1: bands.B6,
      swir2: bands.B7
    };
  }

  private static classifyNDVI(value: number): string {
    if (value < -0.1) return 'water';
    if (value < 0.1) return 'bare_soil';
    if (value < 0.2) return 'sparse_vegetation';
    if (value < 0.4) return 'moderate_vegetation';
    if (value < 0.6) return 'dense_vegetation';
    return 'very_dense_vegetation';
  }

  private static classifyNBR(value: number): string {
    if (value < -0.25) return 'high_severity_burn';
    if (value < -0.1) return 'moderate_severity_burn';
    if (value < 0.1) return 'low_severity_burn';
    if (value < 0.27) return 'unburned';
    return 'enhanced_regrowth';
  }

  private static classifyNDWI(value: number): string {
    if (value < -0.3) return 'very_dry';
    if (value < 0.0) return 'dry';
    if (value < 0.2) return 'moderate_moisture';
    if (value < 0.4) return 'wet';
    return 'water';
  }

  private static classifyEVI(value: number): string {
    if (value < 0.1) return 'no_vegetation';
    if (value < 0.2) return 'sparse_vegetation';
    if (value < 0.4) return 'moderate_vegetation';
    if (value < 0.6) return 'dense_vegetation';
    return 'very_dense_vegetation';
  }

  private static classifySAVI(value: number): string {
    if (value < 0.1) return 'bare_soil';
    if (value < 0.2) return 'sparse_vegetation';
    if (value < 0.4) return 'moderate_vegetation';
    if (value < 0.6) return 'dense_vegetation';
    return 'very_dense_vegetation';
  }

  private static classifyNDMI(value: number): string {
    if (value < -0.3) return 'severely_stressed';
    if (value < 0.0) return 'moderately_stressed';
    if (value < 0.2) return 'slightly_stressed';
    if (value < 0.4) return 'healthy';
    return 'very_healthy';
  }

  private static classifyDNBR(value: number): string {
    if (value < -0.25) return 'enhanced_regrowth_high';
    if (value < -0.1) return 'enhanced_regrowth_low';
    if (value < 0.1) return 'unburned';
    if (value < 0.27) return 'low_severity';
    if (value < 0.44) return 'moderate_low_severity';
    if (value < 0.66) return 'moderate_high_severity';
    return 'high_severity';
  }
}

export const spectralIndicesInfo = {
  NDVI: {
    name: 'Normalized Difference Vegetation Index',
    nameRu: 'Нормализованный разностный вегетационный индекс',
    formula: '(NIR - RED) / (NIR + RED)',
    description: 'Индекс здоровья растительности',
    range: [-1, 1],
    sentinel2Bands: ['B04', 'B08'],
    landsatBands: ['B4', 'B5']
  },
  NBR: {
    name: 'Normalized Burn Ratio',
    nameRu: 'Нормализованный индекс выгорания',
    formula: '(NIR - SWIR2) / (NIR + SWIR2)',
    description: 'Индекс для детекции пожаров и гарей',
    range: [-1, 1],
    sentinel2Bands: ['B08', 'B12'],
    landsatBands: ['B5', 'B7']
  },
  NDWI: {
    name: 'Normalized Difference Water Index',
    nameRu: 'Нормализованный разностный водный индекс',
    formula: '(GREEN - NIR) / (GREEN + NIR)',
    description: 'Индекс содержания воды в растительности',
    range: [-1, 1],
    sentinel2Bands: ['B03', 'B08'],
    landsatBands: ['B3', 'B5']
  },
  EVI: {
    name: 'Enhanced Vegetation Index',
    nameRu: 'Улучшенный вегетационный индекс',
    formula: '2.5 * (NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1)',
    description: 'Улучшенный индекс с коррекцией атмосферы',
    range: [-1, 1],
    sentinel2Bands: ['B02', 'B04', 'B08'],
    landsatBands: ['B2', 'B4', 'B5']
  },
  SAVI: {
    name: 'Soil Adjusted Vegetation Index',
    nameRu: 'Вегетационный индекс с коррекцией на почву',
    formula: '(NIR - RED) / (NIR + RED + L) * (1 + L)',
    description: 'Индекс с коррекцией на влияние почвы',
    range: [-1.5, 1.5],
    sentinel2Bands: ['B04', 'B08'],
    landsatBands: ['B4', 'B5']
  },
  NDMI: {
    name: 'Normalized Difference Moisture Index',
    nameRu: 'Нормализованный разностный индекс влажности',
    formula: '(NIR - SWIR1) / (NIR + SWIR1)',
    description: 'Индекс влажности растительности',
    range: [-1, 1],
    sentinel2Bands: ['B08', 'B11'],
    landsatBands: ['B5', 'B6']
  },
  dNBR: {
    name: 'Differenced Normalized Burn Ratio',
    nameRu: 'Разностный индекс выгорания',
    formula: 'NBR_pre - NBR_post',
    description: 'Оценка степени выгорания территории',
    range: [-2, 2],
    sentinel2Bands: ['B08', 'B12'],
    landsatBands: ['B5', 'B7']
  }
};
