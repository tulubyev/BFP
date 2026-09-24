import L from 'leaflet';
import {
  boundaryFileUrl,
  boundaryStyle,
  describeBoundary,
  districtsVisible,
  labelVisible,
  type BoundaryFile,
  type BoundaryKind,
  type BoundaryProps,
} from './boundaries';
import { BOUNDARIES_VERSION } from './boundariesVersion';
import { popupElement } from './popup';

const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)';

// Districts above regions so they win clicks; labels above both but under markers (600)
const PANES: Record<BoundaryKind | 'labels', { name: string; zIndex: number }> = {
  region: { name: 'boundaries-regions', zIndex: 410 },
  district: { name: 'boundaries-districts', zIndex: 420 },
  labels: { name: 'boundary-labels', zIndex: 450 },
};

function ensurePanes(map: L.Map): void {
  for (const { name, zIndex } of Object.values(PANES)) {
    if (map.getPane(name)) continue;
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
  }
  map.getPane(PANES.labels.name)!.style.pointerEvents = 'none';
}

function boundaryPopup(p: BoundaryProps): HTMLElement {
  const { title, rows, osmUrl } = describeBoundary(p);
  return popupElement(title, rows, { link: osmUrl ? { href: osmUrl, text: 'Открыть в OpenStreetMap →' } : null });
}

function labelMarker(p: BoundaryProps): L.Marker {
  const span = document.createElement('span');
  span.className = `boundary-label boundary-label--${p.kind}`;
  span.textContent = p.name;
  return L.marker([p.label[1], p.label[0]], {
    icon: L.divIcon({ className: '', html: span, iconSize: [0, 0] }),
    interactive: false,
    keyboard: false,
    pane: PANES.labels.name,
  });
}

function setMember(group: L.LayerGroup, layer: L.Layer, show: boolean): void {
  if (show && !group.hasLayer(layer)) group.addLayer(layer);
  if (!show && group.hasLayer(layer)) group.removeLayer(layer);
}

function boundaryOverlay(map: L.Map, kind: BoundaryKind, file: BoundaryFile): L.LayerGroup {
  const overlay = L.layerGroup();
  const labels = L.layerGroup();
  const shapes = L.geoJSON(undefined, {
    pane: PANES[kind].name,
    attribution: ATTRIBUTION,
    style: () => boundaryStyle(kind),
    onEachFeature: (feature, layer) => {
      const props = feature.properties as BoundaryProps;
      const path = layer as L.Path;
      path.on('mouseover', () => path.setStyle(boundaryStyle(kind, true)));
      path.on('mouseout', () => shapes.resetStyle(path));
      path.bindPopup(() => boundaryPopup(props));
      labels.addLayer(labelMarker(props));
    },
  });

  const sync = () => {
    const zoom = map.getZoom();
    setMember(overlay, shapes, kind === 'region' || districtsVisible(zoom));
    setMember(overlay, labels, labelVisible(kind, zoom));
  };

  const base = typeof __CDN_URL__ === 'string' ? __CDN_URL__ : '';
  fetch(boundaryFileUrl(base, file, BOUNDARIES_VERSION))
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(data => {
      shapes.addData(data);
      sync();
    })
    .catch(err => console.warn(`Boundaries ${file} failed:`, err));

  map.on('zoomend', sync);
  sync();
  return overlay;
}

/** Adds region and Baikal-district boundaries to the map (visible by default) and the layer control. */
export function addBoundaryLayers(map: L.Map, control: L.Control.Layers): void {
  ensurePanes(map);
  const regions = boundaryOverlay(map, 'region', 'ru-regions').addTo(map);
  const districts = boundaryOverlay(map, 'district', 'baikal-districts').addTo(map);
  control.addOverlay(regions, 'Границы субъектов РФ (OSM)');
  control.addOverlay(districts, 'Муниципальные районы — Байкал (OSM)');
}
