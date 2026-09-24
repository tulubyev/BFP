import L from 'leaflet';
import { describeHotspot, firmsUrl, hotspotStyle, type FirmsRegion, type HotspotProps } from './firms';
import { popupElement } from './popup';

// Thousands of points: one canvas instead of a DOM node per hotspot
const renderer = L.canvas({ padding: 0.5 });

/** Hotspots of one region; fetched the first time the overlay is switched on. */
function hotspotOverlay(region: FirmsRegion): L.LayerGroup {
  const group = L.layerGroup();
  let requested = false;
  group.on('add', () => {
    if (requested) return;
    requested = true;
    fetch(firmsUrl(region))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(res => {
        if (!res.success || !res.geojson?.features?.length) return;
        L.geoJSON(res.geojson, {
          pointToLayer: (feature, latlng) =>
            L.circleMarker(latlng, { ...hotspotStyle(feature.properties?.confidence), renderer }),
          onEachFeature: (feature, layer) => {
            const { title, rows } = describeHotspot(feature.properties as HotspotProps);
            layer.bindPopup(() => popupElement(`🔥 ${title}`, rows, { titleColor: '#ef4444' }));
          },
        }).addTo(group);
      })
      .catch(err => {
        requested = false; // allow a retry on the next toggle
        console.warn(`FIRMS ${region} fetch failed:`, err);
      });
  });
  return group;
}

/** NASA FIRMS VIIRS hotspots (24 h): Baikal regions on by default, all of Russia on demand. */
export function addFirmsLayers(map: L.Map, control: L.Control.Layers): void {
  const baikal = hotspotOverlay('baikal').addTo(map);
  const russia = hotspotOverlay('russia');
  control.addOverlay(baikal, 'Термоточки FIRMS 24ч — Байкальский регион');
  control.addOverlay(russia, 'Термоточки FIRMS 24ч — вся Россия');
}
