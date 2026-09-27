import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Incident } from '../api/incidents';
import type { IncidentHotspot } from '../api/incidentHotspots';
import { popupElement } from '../map/popup';
import { hotspotRows, incidentBounds, incidentCenter, miniMapBounds } from '../utils/incidentHotspots';

// Same basemap as the home map (CARTO wants an API key now)
const BASEMAP_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const BASEMAP_ATTRIBUTION = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';
const HOTSPOT_ATTRIBUTION = 'Термоточки: NASA FIRMS';

/** Small Leaflet map of one incident: its bbox, centre and FIRMS hotspots (tooltips from text nodes). */
export default function IncidentMiniMap({ incident, hotspots }: { incident: Incident; hotspots: IncidentHotspot[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer(BASEMAP_URL, { attribution: BASEMAP_ATTRIBUTION, maxZoom: 16 }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();

    const bbox = incidentBounds(incident);
    if (bbox) {
      L.rectangle(bbox, { color: '#f97316', weight: 2, fill: true, fillOpacity: 0.08, dashArray: '4 3' })
        .bindTooltip(popupElement('Контур события', [['Граница', 'по крайним термоточкам']]), { sticky: true })
        .addTo(overlay);
    }
    for (const h of hotspots) {
      L.circleMarker([h.lat, h.lon], { radius: 4, color: '#fde047', weight: 1, fillColor: '#ef4444', fillOpacity: 0.85 })
        .bindTooltip(popupElement('Термоточка FIRMS', hotspotRows(h)))
        .addTo(overlay);
    }
    const center = incidentCenter(incident);
    if (center && !hotspots.length) {
      L.circleMarker(center, { radius: 6, color: '#f97316', weight: 2, fillOpacity: 0.4 }).addTo(overlay);
    }
    if (hotspots.length) map.attributionControl.addAttribution(HOTSPOT_ATTRIBUTION);

    const bounds = miniMapBounds(incident, hotspots);
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    else map.setView([53.5, 108], 4);
  }, [incident, hotspots]);

  return <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-lg border border-slate-700 sm:h-72" role="region" aria-label="Карта события" />;
}
