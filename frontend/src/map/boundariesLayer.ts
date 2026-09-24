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

function popupElement(p: BoundaryProps): HTMLElement {
  const { title, rows, osmUrl } = describeBoundary(p);
  const root = document.createElement('div');
  root.style.minWidth = '200px';
  const h = document.createElement('h3');
  h.style.cssText = 'font-weight:bold;margin-bottom:6px;font-size:14px';
  h.textContent = title;
  root.append(h);
  for (const [label, value] of rows) {
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.append(strong, value);
    root.append(row);
  }
  if (osmUrl) {
    const link = document.createElement('a');
    link.href = osmUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'color:#60a5fa;font-size:11px';
    link.textContent = 'Открыть в OpenStreetMap →';
    const p2 = document.createElement('p');
    p2.style.marginTop = '6px';
    p2.append(link);
    root.append(p2);
  }
  return root;
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
      path.bindPopup(() => popupElement(props));
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
