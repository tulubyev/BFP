import { stub, todo, needsWork, AlertLevel, devAlert } from '../utils/devAlerts';
import type { MapConfig, LayerConfig } from '../types';

devAlert(AlertLevel.WARNING, 'MapContainer: Leaflet/MapLibre integration not yet implemented', 'components/MapContainer.ts');

const DEFAULT_CONFIG: MapConfig = {
  center: [53.5, 108.0],
  zoom: 7,
  bounds: [[51.0, 103.0], [56.0, 113.0]],
};

export interface MapState {
  initialized: boolean;
  config: MapConfig;
  layers: LayerConfig[];
}

let mapState: MapState = {
  initialized: false,
  config: DEFAULT_CONFIG,
  layers: [],
};

export function initializeMap(containerId: string, config: MapConfig = DEFAULT_CONFIG): MapState {
  stub('initializeMap', 'components/MapContainer.ts');
  needsWork('Map Initialization', 'Need to integrate Leaflet or MapLibre GL JS', 'components/MapContainer.ts');
  
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Map container #${containerId} not found`);
    return mapState;
  }
  
  container.innerHTML = `
    <div class="flex items-center justify-center h-full bg-slate-800/50 rounded-lg border border-slate-700">
      <div class="text-center p-8">
        <div class="text-6xl mb-4">🗺️</div>
        <h3 class="text-xl font-semibold text-white mb-2">Интерактивная карта</h3>
        <p class="text-slate-400 mb-4">Карта будет отображена здесь</p>
        <div class="text-xs text-slate-500">
          <p>Центр: ${config.center[0].toFixed(2)}°N, ${config.center[1].toFixed(2)}°E</p>
          <p>Масштаб: ${config.zoom}</p>
        </div>
        <div class="mt-4 px-4 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded text-yellow-400 text-sm">
          TODO: Интеграция с Leaflet/MapLibre
        </div>
      </div>
    </div>
  `;
  
  mapState = {
    initialized: true,
    config,
    layers: [],
  };
  
  return mapState;
}

export function addLayer(layer: LayerConfig): void {
  stub('addLayer', 'components/MapContainer.ts');
  todo('addLayer: Implement layer management with proper map library');
  
  mapState.layers.push(layer);
  console.log(`Layer added (stub): ${layer.name}`);
}

export function removeLayer(layerId: string): void {
  stub('removeLayer', 'components/MapContainer.ts');
  
  mapState.layers = mapState.layers.filter(l => l.id !== layerId);
  console.log(`Layer removed (stub): ${layerId}`);
}

export function setView(center: [number, number], zoom: number): void {
  stub('setView', 'components/MapContainer.ts');
  
  mapState.config.center = center;
  mapState.config.zoom = zoom;
  console.log(`View set (stub): center=${center}, zoom=${zoom}`);
}

export function getMapState(): MapState {
  return { ...mapState };
}

export default {
  initializeMap,
  addLayer,
  removeLayer,
  setView,
  getMapState,
};
