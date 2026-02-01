import L from 'leaflet';
import type { MapConfig, LayerConfig } from '../types';

const DEFAULT_CONFIG: MapConfig = {
  center: [53.5, 108.0],
  zoom: 7,
  bounds: [[51.0, 103.0], [56.0, 113.0]],
};

export interface MapState {
  initialized: boolean;
  config: MapConfig;
  layers: LayerConfig[];
  map: L.Map | null;
  layerGroups: Map<string, L.LayerGroup>;
}

let mapState: MapState = {
  initialized: false,
  config: DEFAULT_CONFIG,
  layers: [],
  map: null,
  layerGroups: new Map(),
};

const baseLayers = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  satellite: {
    name: 'Спутник (ESRI)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri'
  },
  terrain: {
    name: 'Рельеф',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap'
  },
  carto: {
    name: 'Carto Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO'
  }
};

export function initializeMap(containerId: string, config: MapConfig = DEFAULT_CONFIG): MapState {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Map container #${containerId} not found`);
    return mapState;
  }

  container.innerHTML = '';
  container.style.minHeight = '400px';

  const map = L.map(containerId, {
    center: config.center as [number, number],
    zoom: config.zoom,
    zoomControl: true,
    attributionControl: true,
  });

  const baseLayer = L.tileLayer(baseLayers.carto.url, {
    attribution: baseLayers.carto.attribution,
    maxZoom: 18,
  });
  baseLayer.addTo(map);

  const layerControl = L.control.layers({
    'Carto Dark': baseLayer,
    'OpenStreetMap': L.tileLayer(baseLayers.osm.url, { attribution: baseLayers.osm.attribution }),
    'Спутник': L.tileLayer(baseLayers.satellite.url, { attribution: baseLayers.satellite.attribution }),
    'Рельеф': L.tileLayer(baseLayers.terrain.url, { attribution: baseLayers.terrain.attribution }),
  }, {
    'Границы и дороги': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      opacity: 0.5
    }),
    'Населенные пункты': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CARTO',
      pane: 'shadowPane'
    })
  }, { position: 'topright' });
  layerControl.addTo(map);

  L.control.scale({ metric: true, imperial: false }).addTo(map);

  addBaikalRegionOverlay(map);

  mapState = {
    initialized: true,
    config,
    layers: [],
    map,
    layerGroups: new Map(),
  };

  console.log('Map initialized with Leaflet');
  return mapState;
}

function addBaikalRegionOverlay(map: L.Map): void {
  const baikalBounds: L.LatLngBoundsExpression = [[51.0, 100.0], [56.0, 112.0]];
  
  L.rectangle(baikalBounds, {
    color: '#22c55e',
    weight: 2,
    fillOpacity: 0.05,
    dashArray: '5, 5',
  }).addTo(map).bindPopup('Байкальская природная территория');

  const baikalCenter: L.LatLngExpression = [53.5, 108.0];
  L.marker(baikalCenter, {
    icon: L.divIcon({
      className: 'custom-marker',
      html: '<div style="background: #3b82f6; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
      iconSize: [12, 12],
    }),
  }).addTo(map).bindPopup('<strong>Озеро Байкал</strong><br>Центр мониторинга');
}

export async function loadForestAreas(map: L.Map): Promise<void> {
  try {
    const response = await fetch('/api/monitoring/forest-areas/geojson');
    const geojson = await response.json();
    
    const forestLayer = L.geoJSON(geojson, {
      style: (feature) => {
        const colors: Record<string, string> = {
          reserve: '#16a34a',
          national_park: '#22c55e',
          protected: '#84cc16',
          none: '#6b7280',
        };
        return {
          color: colors[feature?.properties?.protection_status] || '#6b7280',
          weight: 2,
          fillOpacity: 0.3,
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <strong>${p.name}</strong><br>
          Регион: ${p.region}<br>
          Тип: ${p.forest_type}<br>
          Площадь: ${p.area_ha?.toLocaleString()} га<br>
          Статус: ${p.protection_status}
        `);
      },
    });
    
    forestLayer.addTo(map);
    mapState.layerGroups.set('forest_areas', forestLayer);
    console.log('Forest areas loaded:', geojson.features?.length);
  } catch (error) {
    console.error('Error loading forest areas:', error);
  }
}

export async function loadForestChanges(map: L.Map, changeType?: string): Promise<void> {
  try {
    let url = '/api/monitoring/forest-changes/geojson';
    if (changeType) {
      url += `?change_type=${changeType}`;
    }
    
    const response = await fetch(url);
    const geojson = await response.json();
    
    const changeIcons: Record<string, { color: string; icon: string }> = {
      fire: { color: '#ef4444', icon: '🔥' },
      logging: { color: '#a3a3a3', icon: '🪓' },
      disease: { color: '#a855f7', icon: '🦠' },
      windfall: { color: '#64748b', icon: '💨' },
      regrowth: { color: '#22c55e', icon: '🌱' },
    };
    
    const changesLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        const type = feature.properties?.change_type || 'other';
        const iconConfig = changeIcons[type] || { color: '#6b7280', icon: '📍' };
        
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'change-marker',
            html: `<div style="font-size: 20px;">${iconConfig.icon}</div>`,
            iconSize: [24, 24],
          }),
        });
      },
      style: (feature) => {
        const type = feature?.properties?.change_type || 'other';
        const iconConfig = changeIcons[type] || { color: '#6b7280', icon: '📍' };
        return {
          color: iconConfig.color,
          weight: 2,
          fillOpacity: 0.4,
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        let popupContent = `
          <strong>${p.change_type?.toUpperCase()}</strong><br>
          Дата: ${p.detected_date}<br>
          Площадь: ${p.area_ha} га<br>
          Серьёзность: ${p.severity}<br>
          Источник: ${p.source}
        `;
        
        if (p.logging_permit_id) {
          popupContent += `
            <hr class="my-2 border-slate-600">
            <div class="text-xs bg-slate-800 p-2 rounded">
              <strong>Разрешение:</strong> ${p.logging_permit_id}<br>
              <strong>Исполнитель:</strong> ${p.contractor_name || 'н/д'}<br>
              <strong>Контроль:</strong> ${p.control_authority || 'Рослесхоз'}<br>
              <strong>Срок до:</strong> ${p.permit_expiry_date || 'н/д'}
            </div>
          `;
        }
        
        layer.bindPopup(popupContent);
      },
    });
    
    changesLayer.addTo(map);
    mapState.layerGroups.set('forest_changes', changesLayer);
    console.log('Forest changes loaded:', geojson.features?.length);
  } catch (error) {
    console.error('Error loading forest changes:', error);
  }
}

export async function loadFireHotspots(map: L.Map, days: number = 7): Promise<void> {
  try {
    const response = await fetch(`/api/monitoring/fire-hotspots/geojson?days=${days}`);
    const geojson = await response.json();
    
    const fireLayer = L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        const frp = feature.properties?.frp || 0;
        const radius = Math.min(5 + frp / 5, 15);
        
        return L.circleMarker(latlng, {
          radius,
          color: '#dc2626',
          fillColor: '#ef4444',
          fillOpacity: 0.7,
          weight: 2,
        });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <strong>🔥 Термоточка</strong><br>
          Дата: ${p.date}<br>
          Время: ${p.time}<br>
          Спутник: ${p.satellite}<br>
          Яркость: ${p.brightness}K<br>
          FRP: ${p.frp} MW<br>
          Достоверность: ${p.confidence}
        `);
      },
    });
    
    fireLayer.addTo(map);
    mapState.layerGroups.set('fire_hotspots', fireLayer);
    console.log('Fire hotspots loaded:', geojson.features?.length);
  } catch (error) {
    console.error('Error loading fire hotspots:', error);
  }
}

export function addGeoJSONLayer(map: L.Map, geojson: any, options: L.GeoJSONOptions = {}): L.GeoJSON {
  const layer = L.geoJSON(geojson, options);
  layer.addTo(map);
  return layer;
}

export function addLayer(layer: LayerConfig): void {
  if (!mapState.map) {
    console.warn('Map not initialized');
    return;
  }
  
  mapState.layers.push(layer);
  console.log(`Layer added: ${layer.name}`);
}

export function removeLayer(layerId: string): void {
  if (!mapState.map) return;
  
  const layerGroup = mapState.layerGroups.get(layerId);
  if (layerGroup) {
    mapState.map.removeLayer(layerGroup);
    mapState.layerGroups.delete(layerId);
  }
  
  mapState.layers = mapState.layers.filter(l => l.id !== layerId);
  console.log(`Layer removed: ${layerId}`);
}

export function toggleLayer(layerId: string, visible: boolean): void {
  if (!mapState.map) return;
  
  const layerGroup = mapState.layerGroups.get(layerId);
  if (layerGroup) {
    if (visible) {
      mapState.map.addLayer(layerGroup);
    } else {
      mapState.map.removeLayer(layerGroup);
    }
  }
}

export function setView(center: [number, number], zoom: number): void {
  if (mapState.map) {
    mapState.map.setView(center, zoom);
  }
  mapState.config.center = center;
  mapState.config.zoom = zoom;
}

export function fitBounds(bounds: L.LatLngBoundsExpression): void {
  if (mapState.map) {
    mapState.map.fitBounds(bounds);
  }
}

export function getMap(): L.Map | null {
  return mapState.map;
}

export function getMapState(): MapState {
  return { ...mapState };
}

export default {
  initializeMap,
  loadForestAreas,
  loadForestChanges,
  loadFireHotspots,
  addGeoJSONLayer,
  addLayer,
  removeLayer,
  toggleLayer,
  setView,
  fitBounds,
  getMap,
  getMapState,
};
