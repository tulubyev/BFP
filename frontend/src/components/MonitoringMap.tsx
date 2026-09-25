import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSearchParams } from 'react-router-dom';
import { parseIncidentId } from '../utils/incidents';
import { addBoundaryLayers } from '../map/boundariesLayer';
import { addFirmsLayers } from '../map/firmsLayer';
import { addOoptLayer } from '../map/ooptLayer';
import { addSourcesControl } from '../map/sourcesControl';

const TRANSPARENT_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '', iconRetinaUrl: '' });

function addMapLegend(map: L.Map): L.Control {
  const Legend = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', '');
      div.style.cssText = [
        'background:rgba(15,23,42,0.93)',
        'border:1px solid #334155',
        'border-radius:8px',
        'padding:10px 14px',
        'font-size:12px',
        'color:#cbd5e1',
        'min-width:225px',
        'pointer-events:auto',
        'backdrop-filter:blur(4px)',
      ].join(';');
      div.innerHTML = `
        <p style="font-weight:700;color:#fff;margin:0 0 8px 0;font-size:13px">Легенда</p>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:6px;background:linear-gradient(90deg,#fbbf24,#dc2626);border-radius:2px;display:inline-block"></span>
            <span>Потери леса 2001 → 2025 (Hansen/UMD)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:6px;background:#ec4899;border-radius:2px;display:inline-block"></span>
            <span>Нарушения леса DIST-ALERT, 2 года (GFW)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:14px;height:14px;background:rgba(16,185,129,0.3);border:2px solid #10b981;border-radius:50%;display:inline-block"></span>
            <span>Заповедник (OSM/Минприроды)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:14px;height:14px;background:rgba(139,92,246,0.3);border:2px solid #8b5cf6;border-radius:50%;display:inline-block"></span>
            <span>Национальный парк (OSM/Минприроды)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:10px;height:10px;background:#ef4444;border:2px solid #fbbf24;border-radius:50%;display:inline-block"></span>
            <span>Термоточка FIRMS 24ч (NASA VIIRS)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:0;border-top:2px solid #e2e8f0;display:inline-block"></span>
            <span>Граница субъекта РФ (OSM)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:0;border-top:2px dashed #94a3b8;display:inline-block"></span>
            <span>Муниципальный район (OSM)</span>
          </div>
          <hr style="border:none;border-top:1px solid #334155;margin:4px 0"/>
          <p style="font-size:10px;color:#64748b;margin:0">
            Hansen/UMD · GFW (CC BY 4.0) · NASA FIRMS · OSM © contributors (ODbL) · Esri · Рослесхоз
          </p>
        </div>`;
      return div;
    },
  });
  const legend = new Legend();
  legend.addTo(map);
  return legend;
}

/**
 * The map — the product's primary element (future.md #6). All layers, controls and deep-link
 * behaviour (?lat=&lng=&incident=) are unchanged from the pre-redesign HomePage; only the
 * surrounding page layout changed.
 */
function MonitoringMap() {
  const [searchParams] = useSearchParams();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const queryLat = Number(searchParams.get('lat'));
    const queryLng = Number(searchParams.get('lng'));
    const hasTarget = Number.isFinite(queryLat) && Number.isFinite(queryLng) && searchParams.has('lat') && searchParams.has('lng');
    const map = L.map(mapRef.current).setView(hasTarget ? [queryLat, queryLng] : [53.5, 108.0], hasTarget ? 12 : 5);
    mapInstanceRef.current = map;

    // Base layers
    const baseLayers: Record<string, L.TileLayer> = {
      // CARTO basemaps now return "API KEY REQUIRED" tiles without a key — Esri Dark Gray instead
      'Тёмная (Esri)': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }
      ),
      'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }),
      'ESRI Спутник': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri', maxZoom: 19 }
      ),
    };
    baseLayers['Тёмная (Esri)'].addTo(map);

    // ── GFW через /tiles/gfw: сервер раскрашивает закодированные плитки GFW и кэширует их ──
    // (с CDN_URL плитки идут через CDN). © Hansen/UMD/Google/USGS/NASA, GLAD/UMD via GFW, CC BY 4.0
    const tileBase = __CDN_URL__;
    const GFW_ATTRIBUTION = '© Hansen/UMD/Google/USGS/NASA, GLAD/UMD via GFW (CC BY 4.0)';

    // Потери леса 2001–2025 (v1.13): плитки 512 px, поэтому zoomOffset -1 — вчетверо меньше запросов
    const gfwLossTiles = L.tileLayer(`${tileBase}/tiles/gfw/loss/{z}/{x}/{y}.png`, {
      attribution: GFW_ATTRIBUTION, tileSize: 512, zoomOffset: -1,
      minZoom: 3, maxNativeZoom: 14, maxZoom: 19, errorTileUrl: TRANSPARENT_TILE,
    });

    // Нарушения лесного покрова DIST-ALERT (глобальные, обновляются еженедельно, последние 2 года)
    const distAlertsTiles = L.tileLayer(`${tileBase}/tiles/gfw/dist/{z}/{x}/{y}.png`, {
      attribution: GFW_ATTRIBUTION, minZoom: 3, maxNativeZoom: 14, maxZoom: 19, errorTileUrl: TRANSPARENT_TILE,
    });

    // Лесной покров 2000 г. (сомкнутость ≥ 30%)
    const gfwDensityTiles = L.tileLayer(`${tileBase}/tiles/gfw/cover/{z}/{x}/{y}.png`, {
      attribution: GFW_ATTRIBUTION, opacity: 0.5, minZoom: 3, maxNativeZoom: 12, maxZoom: 19, errorTileUrl: TRANSPARENT_TILE,
    });

    // Layer control — static tile overlays only; async layers register themselves below
    const overlayLayers: Record<string, L.Layer> = {
      'Потери леса 2001–2025 (Hansen/UMD)': gfwLossTiles,
      'Нарушения леса DIST-ALERT, 2 года (GFW)': distAlertsTiles,
      'Лесной покров 2000 (Hansen/UMD)': gfwDensityTiles,
    };

    gfwLossTiles.addTo(map);
    distAlertsTiles.addTo(map);

    const layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
    addBoundaryLayers(map, layerControl);
    addOoptLayer(map, layerControl);
    addFirmsLayers(map, layerControl);
    addMapLegend(map);
    addSourcesControl(map);
    if (hasTarget) {
      const incidentId = parseIncidentId(searchParams.get('incident'));
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = incidentId ? `Инцидент #${incidentId}` : 'Точка мониторинга';
      const coordinates = document.createElement('p');
      coordinates.textContent = `Координаты: ${queryLat.toFixed(5)}, ${queryLng.toFixed(5)}`;
      popup.append(title, coordinates);
      // Default Leaflet icon has no image here (iconUrl cleared above) — L.marker without an icon throws
      const targetIcon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;background:#facc15;border:3px solid #0f172a;border-radius:50%;box-shadow:0 0 0 3px rgba(250,204,21,0.45);"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10],
      });
      L.marker([queryLat, queryLng], { icon: targetIcon }).addTo(map).bindPopup(popup).openPopup();
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [searchParams]);

  return (
    <div id="map" className="card scroll-mt-4 overflow-hidden">
      <div ref={mapRef} className="h-[420px] w-full sm:h-[520px] lg:h-[620px]" />
    </div>
  );
}

export default MonitoringMap;
