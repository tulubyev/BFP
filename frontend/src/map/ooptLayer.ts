import L from 'leaflet';
import { describeOopt, ooptMarkerVisible, ooptStyle, withAlpha, type OoptProps } from './oopt';

/** Text-node based popup (no innerHTML) — OSM data is edited by the public, never trust it as HTML. */
function ooptPopup(p: OoptProps): HTMLElement {
  const { title, typeLabel, classLabel, areaText } = describeOopt(p);
  const root = document.createElement('div');
  root.style.minWidth = '210px';

  const h = document.createElement('h3');
  h.style.cssText = 'font-weight:bold;margin-bottom:6px;font-size:14px';
  h.textContent = title;
  root.append(h);

  const row = (label: string, value: string) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, value);
    return p;
  };
  root.append(row('Тип', typeLabel));
  root.append(row('Категория МСОП', classLabel));
  if (areaText) root.append(row('Площадь', areaText));

  if (p.website) {
    const para = document.createElement('p');
    const a = document.createElement('a');
    a.href = p.website;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.color = '#60a5fa';
    a.textContent = 'Официальный сайт →';
    para.append(a);
    root.append(para);
  }

  const source = document.createElement('p');
  source.style.cssText = 'font-size:10px;color:#888;margin-top:6px';
  const sourceLink = document.createElement('a');
  sourceLink.href = p.osm_url;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  sourceLink.style.color = '#60a5fa';
  sourceLink.textContent = 'OpenStreetMap';
  source.append('Источник: ', sourceLink, ' (данные Минприроды России)');
  root.append(source);

  return root;
}

function labelMarker(p: OoptProps): L.Marker {
  const border = ooptStyle(p).color;
  const html = `<div style="width:14px;height:14px;background:${withAlpha(border, 0.35)};border:2px solid ${border};border-radius:50%;box-shadow:0 0 6px ${withAlpha(border, 0.5)}"></div>`;
  return L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: '', html, iconSize: [14, 14], iconAnchor: [7, 7] }),
  }).bindPopup(() => ooptPopup(p));
}

/**
 * ООПТ — заповедники и нацпарки: polygons (fetched once, added to the layer control) plus a
 * small label marker per feature, shown only below zoom 6 where a reserve's polygon can be a
 * few pixels wide. A degraded relation without enough geometry to form a ring arrives as a
 * Point (see overpassService.ts) and is rendered as a marker only.
 */
export function addOoptLayer(map: L.Map, control: L.Control.Layers, onCount?: (n: number) => void): void {
  const group = L.layerGroup().addTo(map);
  const shapes = L.geoJSON(undefined, {
    style: feature => ooptStyle(feature!.properties as OoptProps),
    onEachFeature: (feature, layer) => layer.bindPopup(() => ooptPopup(feature.properties as OoptProps)),
  });
  const markers = L.layerGroup();
  group.addLayer(shapes);
  control.addOverlay(group, 'ООПТ — заповедники и нацпарки (OSM)');

  const sync = () => {
    const show = ooptMarkerVisible(map.getZoom());
    if (show && !group.hasLayer(markers)) group.addLayer(markers);
    if (!show && group.hasLayer(markers)) group.removeLayer(markers);
  };

  fetch('/api/external/oopt')
    .then(r => r.json())
    .then(res => {
      if (!res.success || !res.geojson?.features?.length) return;
      onCount?.(res.count);
      // Degraded relations (missing member geometry) arrive as a Point — no polygon to draw,
      // just the label marker below, which every feature gets regardless of geometry type.
      const polygons = res.geojson.features.filter((f: GeoJSON.Feature) => f.geometry.type !== 'Point');
      const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: polygons };
      shapes.addData(collection);
      for (const feature of res.geojson.features) markers.addLayer(labelMarker(feature.properties as OoptProps));
      sync();
    })
    .catch(err => console.warn('ООПТ fetch failed:', err));

  map.on('zoomend', sync);
  sync();
}
