import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addBoundaryLayers } from '../map/boundariesLayer';
import { addFirmsLayers } from '../map/firmsLayer';
import { addOoptLayer } from '../map/ooptLayer';
import { addSourcesControl } from '../map/sourcesControl';
import { isCompactMap } from '../map/mapLayout';
import { createIncidentsLayer, type IncidentsLayer } from '../map/incidentsLayer';
import { INCIDENT_COLORS, incidentCardUrl } from '../map/incidents';
import { popupElement } from '../map/popup';
import {
  BASE_IDS,
  OVERLAY_IDS,
  mapShareUrl,
  mapStateQuery,
  parseMapState,
  sameMapState,
  debounce,
  type BaseId,
  type MapState,
  type OverlayId,
  type ParsedMapState,
} from '../map/mapState';

const TRANSPARENT_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '', iconRetinaUrl: '' });

function addMapLegend(map: L.Map, collapsed: boolean): L.Control {
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
        `min-width:${collapsed ? 0 : 225}px`,
        'pointer-events:auto',
        'backdrop-filter:blur(4px)',
      ].join(';');
      // Static markup only (no API data); a <details> so phones can keep it folded
      div.innerHTML = `
        <details${collapsed ? '' : ' open'}>
        <summary style="font-weight:700;color:#fff;margin:0;font-size:13px;cursor:pointer">Легенда</summary>
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:8px">
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
            <span style="width:14px;height:10px;background:${INCIDENT_COLORS.active}40;border:2px solid ${INCIDENT_COLORS.active};display:inline-block"></span>
            <span>Инцидент FIRMS, активен (30 дней)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:14px;height:10px;border:2px dashed ${INCIDENT_COLORS.inactive};display:inline-block"></span>
            <span>Инцидент FIRMS, затих</span>
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
        </div>
        </details>`;
      return div;
    },
  });
  const legend = new Legend();
  legend.addTo(map);
  return legend;
}

/** Pin for a linked point or an incident that is not in the layer (older than 30 days, layer off). */
function addTargetMarker(map: L.Map, state: ParsedMapState): L.Marker {
  const [lat, lng] = state.center;
  const rows: Array<[string, string]> = [['Координаты', `${lat.toFixed(5)}, ${lng.toFixed(5)}`]];
  const link = state.incident ? { href: incidentCardUrl(state.incident), text: 'Открыть карточку →', newTab: false } : null;
  const popup = popupElement(state.incident ? `Инцидент #${state.incident}` : 'Точка мониторинга', rows, { link });
  // Default Leaflet icon has no image here (iconUrl cleared above) — L.marker without an icon throws
  const targetIcon = L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;background:#facc15;border:3px solid #0f172a;border-radius:50%;box-shadow:0 0 0 3px rgba(250,204,21,0.45);"></div>',
    iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10],
  });
  const marker = L.marker([lat, lng], { icon: targetIcon }).addTo(map).bindPopup(popup);
  marker.openPopup();
  return marker;
}

/** Everything the React side needs to read or change the live map. */
interface MapHandle {
  map: L.Map;
  overlays: Record<OverlayId, L.Layer>;
  bases: Record<BaseId, L.TileLayer>;
  incidents: IncidentsLayer;
  selectedIncident: number | null;
  target: L.Marker | null;
}

function currentState(h: MapHandle): MapState {
  const center = h.map.getCenter();
  return {
    center: [center.lat, center.lng],
    zoom: h.map.getZoom(),
    overlays: OVERLAY_IDS.filter(id => h.map.hasLayer(h.overlays[id])),
    base: BASE_IDS.find(id => h.map.hasLayer(h.bases[id])) ?? 'dark',
    incident: h.selectedIncident,
  };
}

/** Switches layers to match a state; untouched layers are neither removed nor redrawn. */
function applyLayers(h: MapHandle, state: MapState): void {
  for (const id of BASE_IDS) {
    const on = id === state.base;
    if (on && !h.map.hasLayer(h.bases[id])) h.bases[id].addTo(h.map);
    if (!on && h.map.hasLayer(h.bases[id])) h.map.removeLayer(h.bases[id]);
  }
  for (const id of OVERLAY_IDS) {
    const on = state.overlays.includes(id);
    if (on && !h.map.hasLayer(h.overlays[id])) h.overlays[id].addTo(h.map);
    if (!on && h.map.hasLayer(h.overlays[id])) h.map.removeLayer(h.overlays[id]);
  }
}

/** Target pin and incident selection of a freshly parsed link. */
function applySelection(h: MapHandle, state: ParsedMapState): void {
  h.target?.remove();
  h.target = state.showTarget ? addTargetMarker(h.map, state) : null;
  h.selectedIncident = state.incident;
  if (state.incident !== null) h.incidents.select(state.incident, { focus: !state.hasCenter });
}

const URL_UPDATE_DELAY_MS = 400;

/**
 * The map — the product's primary element (future.md #6). Its view (centre, zoom, layers, basemap,
 * selected incident) lives in the URL (map/mapState.ts): the map is created once, map events write
 * the URL (replace, debounced), and only a URL change from outside (a link, back/forward) moves
 * the map — the map's own URL updates never redraw it. Legacy `/?lat&lng&incident` links work as
 * before.
 */
function MonitoringMap() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);
  /** The query string the map itself wrote last — echoes of it are not applied back. */
  const writtenRef = useRef<string | null>(null);
  const initialParams = useRef(searchParams);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (!mapRef.current || handleRef.current) return;

    const initial = parseMapState(initialParams.current);
    const map = L.map(mapRef.current).setView(initial.center, initial.zoom);

    // Base layers
    const bases: Record<BaseId, L.TileLayer> = {
      // CARTO basemaps now return "API KEY REQUIRED" tiles without a key — Esri Dark Gray instead
      dark: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }
      ),
      osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }),
      satellite: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri', maxZoom: 19 }
      ),
    };
    const baseLayers: Record<string, L.TileLayer> = {
      'Тёмная (Esri)': bases.dark,
      'OpenStreetMap': bases.osm,
      'ESRI Спутник': bases.satellite,
    };

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

    const compact = isCompactMap(window.innerWidth);
    const layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: compact }).addTo(map);
    const boundaries = addBoundaryLayers(map, layerControl);
    const oopt = addOoptLayer(map, layerControl);
    const firms = addFirmsLayers(layerControl);

    const writeUrl = debounce(() => {
      const h = handleRef.current;
      if (!h) return;
      const current = new URLSearchParams(window.location.search);
      const query = mapStateQuery(currentState(h), current);
      const normalized = new URLSearchParams(query).toString();
      if (normalized === current.toString()) return;
      writtenRef.current = normalized;
      // a plain search string keeps the commas of `layers` readable (URLSearchParams would encode them)
      navigateRef.current({ search: `?${query}`, hash: window.location.hash }, { replace: true, preventScrollReset: true });
    }, URL_UPDATE_DELAY_MS);

    const incidents = createIncidentsLayer(map, layerControl, {
      onSelect: id => {
        const h = handleRef.current;
        if (!h) return;
        h.selectedIncident = id;
        // the pin of a linked incident is replaced by the incident itself once one is picked
        if (id !== null && h.target) {
          h.target.remove();
          h.target = null;
        }
        writeUrl();
      },
      onResolved: (id, found) => {
        const h = handleRef.current;
        if (found && h?.target && h.selectedIncident === id) {
          h.target.remove();
          h.target = null;
        }
      },
    });

    const handle: MapHandle = {
      map,
      bases,
      overlays: {
        loss: gfwLossTiles,
        dist: distAlertsTiles,
        cover: gfwDensityTiles,
        regions: boundaries.regions,
        districts: boundaries.districts,
        oopt,
        'firms-baikal': firms.baikal,
        'firms-russia': firms.russia,
        incidents: incidents.overlay,
      },
      incidents,
      selectedIncident: null,
      target: null,
    };
    handleRef.current = handle;
    writtenRef.current = initialParams.current.toString();

    applyLayers(handle, initial);
    addMapLegend(map, compact);
    addSourcesControl(map);
    applySelection(handle, initial);

    map.on('moveend overlayadd overlayremove baselayerchange', () => writeUrl());

    return () => {
      writeUrl.cancel();
      incidents.destroy();
      map.remove();
      handleRef.current = null;
    };
  }, []);

  // A URL change the map did not write itself (link on the same page, back/forward): move the map.
  useEffect(() => {
    const h = handleRef.current;
    const query = searchParams.toString();
    if (!h || query === writtenRef.current) return;
    writtenRef.current = query;
    const next = parseMapState(searchParams);
    const now = currentState(h);
    if (sameMapState(now, next)) return;
    const moved = now.zoom !== next.zoom
      || now.center[0].toFixed(5) !== next.center[0].toFixed(5)
      || now.center[1].toFixed(5) !== next.center[1].toFixed(5);
    if (moved) h.map.setView(next.center, next.zoom);
    applyLayers(h, next);
    if (next.incident !== now.incident) {
      h.map.closePopup();
      applySelection(h, next);
    }
  }, [searchParams]);

  const copyLink = useCallback(async () => {
    const h = handleRef.current;
    if (!h) return;
    const url = mapShareUrl(
      window.location.origin, window.location.pathname, currentState(h), new URLSearchParams(window.location.search),
    );
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('copied');
    } catch {
      // clipboard API needs a secure context and permission — show the link to copy by hand
      window.prompt('Ссылка на текущий вид карты:', url);
      setCopyStatus('failed');
    }
    window.setTimeout(() => setCopyStatus('idle'), 2500);
  }, []);

  return (
    <div id="map" className="card scroll-mt-4 overflow-hidden">
      <div ref={mapRef} className="h-[420px] w-full sm:h-[520px] lg:h-[620px]" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-3 py-2 text-xs text-slate-400">
        <span>Вид карты (центр, масштаб, слои, выбранный инцидент) сохраняется в адресе страницы.</span>
        <button
          type="button"
          onClick={copyLink}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:border-green-500/60 hover:text-white"
        >
          {copyStatus === 'copied' ? 'Ссылка скопирована ✓' : 'Скопировать ссылку на карту'}
        </button>
      </div>
    </div>
  );
}

export default MonitoringMap;
