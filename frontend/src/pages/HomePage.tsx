import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link, useSearchParams } from 'react-router-dom';
import { getIncidents, type Incident } from '../api/incidents';
import IncidentCard from '../components/IncidentCard';
import { parseIncidentId } from '../utils/incidents';

interface RosleskhozSummary {
  total_wood_volume_thousand_m3: number;
  total_forestland_area_thousand_ha: number;
  reforestation_latest: { year: number; area_thousand_ha: number } | null;
  fires_area_thousand_ha: number;
}

interface HotspotStats {
  count: number;
  high: number;
}

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
            <span style="width:16px;height:4px;background:#ef4444;border-radius:2px;display:inline-block"></span>
            <span>Потери леса 2001–2023 (Hansen/UMD)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:4px;background:#f97316;border-radius:2px;display:inline-block"></span>
            <span>GLAD-алерты вырубок (GFW)</span>
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
          <hr style="border:none;border-top:1px solid #334155;margin:4px 0"/>
          <p style="font-size:10px;color:#64748b;margin:0">
            Hansen/UMD · GFW · NASA FIRMS · OSM © contributors (ODbL) · Рослесхоз
          </p>
        </div>`;
      return div;
    },
  });
  const legend = new Legend();
  legend.addTo(map);
  return legend;
}

function HomePage() {
  const [searchParams] = useSearchParams();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const [rosleshoz, setRosleshoz] = useState<RosleskhozSummary | null>(null);
  const [, setHotspotStats] = useState<HotspotStats | null>(null);
  const [, setOoptCount] = useState<number | null>(null);
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [recentIncidents, setRecentIncidents] = useState<Incident[]>([]);

  // ── Fetch statistics ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'));

    fetch('/api/external/rosleshoz/summary')
      .then(r => r.json())
      .then(res => { if (res.success) setRosleshoz(res.data); })
      .catch(console.error);
    getIncidents({ limit: 3 }).then(result => {
      if (result.success) setRecentIncidents(result.data);
    }).catch(console.error);
  }, []);

  // ── Map initialisation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const queryLat = Number(searchParams.get('lat'));
    const queryLng = Number(searchParams.get('lng'));
    const hasTarget = Number.isFinite(queryLat) && Number.isFinite(queryLng) && searchParams.has('lat') && searchParams.has('lng');
    const map = L.map(mapRef.current).setView(hasTarget ? [queryLat, queryLng] : [53.5, 108.0], hasTarget ? 12 : 5);
    mapInstanceRef.current = map;
    let alive = true;

    // Base layers
    const baseLayers: Record<string, L.TileLayer> = {
      'CartoDB Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', maxZoom: 19,
      }),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }),
      'ESRI Спутник': L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: '© Esri', maxZoom: 19 }
      ),
      'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap', maxZoom: 17,
      }),
    };
    baseLayers['CartoDB Dark'].addTo(map);

    // ── GFW: потери леса Hansen/UMD 30m 2001-2023 ───────────────────────────
    const gfwLossTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.9/tcd_30/{z}/{x}/{y}.png',
      { attribution: '© Hansen/UMD/Google/USGS/NASA via GFW', opacity: 0.85, maxZoom: 16, minZoom: 3, errorTileUrl: TRANSPARENT_TILE }
    );

    // ── GFW: GLAD Landsat Deforestation Alerts ───────────────────────────────
    const gladAlertsTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_glad_landsat_alerts/v20230224/dynamic/{z}/{x}/{y}.png?implementation=default',
      { attribution: '© GLAD/UMD via GFW', opacity: 0.9, maxZoom: 16, minZoom: 3, errorTileUrl: TRANSPARENT_TILE }
    );

    // ── GFW: лесной покров (опционально) ─────────────────────────────────────
    const gfwDensityTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_tree_cover/v1.9/tcd_30/{z}/{x}/{y}.png',
      { attribution: '© Hansen/UMD via GFW', opacity: 0.6, maxZoom: 16, minZoom: 3, errorTileUrl: TRANSPARENT_TILE }
    );

    // ── ФГИС ЛК WMS ──────────────────────────────────────────────────────────
    const fgisLkWMS = (L.tileLayer as any).wms('https://pub.fgislk.gov.ru/plk/geoservermaster/geoserver/ows', {
      layers: 'plk:plk_les_use',
      format: 'image/png',
      transparent: true,
      version: '1.1.1',
      attribution: '© ФГИС ЛК / Рослесхоз',
      opacity: 0.55,
      errorTileUrl: TRANSPARENT_TILE,
    });

    // ── Esri административные границы ────────────────────────────────────────
    const adminBoundaries = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    );

    // ООПТ layer group (filled after async fetch)
    const ooptGroup = L.layerGroup();
    // FIRMS layer group (filled after async fetch)
    const firmsGroup = L.layerGroup();

    // Layer control — static tile overlays only; async layers added below after fetch
    const overlayLayers: Record<string, L.Layer> = {
      'Потери леса GFW 2001–2023': gfwLossTiles,
      'GLAD-алерты вырубок (GFW)': gladAlertsTiles,
      'Лесной покров (GFW)': gfwDensityTiles,
      'ФГИС ЛК — лесопользование (Рослесхоз)': fgisLkWMS,
      'Административные границы': adminBoundaries,
    };

    gfwLossTiles.addTo(map);
    gladAlertsTiles.addTo(map);
    ooptGroup.addTo(map);
    firmsGroup.addTo(map);

    const layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
    // Add async-filled group layers once — they'll be populated after fetch
    layerControl.addOverlay(ooptGroup, 'ООПТ — заповедники и нацпарки (OSM)');
    layerControl.addOverlay(firmsGroup, 'Термоточки FIRMS 24ч (NASA VIIRS)');
    addMapLegend(map);
    if (hasTarget) {
      const incidentId = parseIncidentId(searchParams.get('incident'));
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = incidentId ? `Инцидент #${incidentId}` : 'Точка мониторинга';
      const coordinates = document.createElement('p');
      coordinates.textContent = `Координаты: ${queryLat.toFixed(5)}, ${queryLng.toFixed(5)}`;
      popup.append(title, coordinates);
      L.marker([queryLat, queryLng]).addTo(map).bindPopup(popup).openPopup();
    }

    // ── ООПТ: заповедники и нацпарки из OSM / Overpass API ───────────────────
    // Данные © OpenStreetMap contributors, ODbL
    fetch('/api/external/oopt')
      .then(r => r.json())
      .then(res => {
        if (!alive || !res.success || !res.geojson?.features?.length) return;

        setOoptCount(res.count);

        const zapovednikIcon = L.divIcon({
          className: '',
          html: '<div style="width:14px;height:14px;background:rgba(16,185,129,0.35);border:2px solid #10b981;border-radius:50%;box-shadow:0 0 6px rgba(16,185,129,0.5);"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7],
        });
        const natsionalparkIcon = L.divIcon({
          className: '',
          html: '<div style="width:14px;height:14px;background:rgba(139,92,246,0.35);border:2px solid #8b5cf6;border-radius:50%;box-shadow:0 0 6px rgba(139,92,246,0.5);"></div>',
          iconSize: [14, 14], iconAnchor: [7, 7],
        });

        L.geoJSON(res.geojson, {
          pointToLayer: (feature, latlng) => {
            const isNP = feature.properties?.boundary === 'national_park';
            return L.marker(latlng, { icon: isNP ? natsionalparkIcon : zapovednikIcon });
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            const typeLabel = p.boundary === 'national_park' ? '🌿 Национальный парк' : '🏔 Заповедник';
            const classLabel = p.protect_class === '1' ? 'Ia/Ib (строго охраняемый)' : p.protect_class === '2' ? 'II (нацпарк)' : (p.protect_class || '—');
            layer.bindPopup(`
              <div style="min-width:210px">
                <h3 style="font-weight:bold;margin-bottom:6px;font-size:14px">${p.name}</h3>
                <p><strong>Тип:</strong> ${typeLabel}</p>
                <p><strong>Категория МСОП:</strong> ${classLabel}</p>
                ${p.area_ha ? `<p><strong>Площадь:</strong> ${Number(p.area_ha).toLocaleString('ru-RU')} га</p>` : ''}
                ${p.website ? `<p><a href="${p.website}" target="_blank" rel="noopener" style="color:#60a5fa">Официальный сайт →</a></p>` : ''}
                <p style="font-size:10px;color:#888;margin-top:6px">
                  Источник: <a href="${p.osm_url}" target="_blank" rel="noopener" style="color:#60a5fa">OpenStreetMap</a> (данные Минприроды России)
                </p>
              </div>
            `);
          },
        }).addTo(ooptGroup);
      })
      .catch(err => console.warn('ООПТ fetch failed:', err));

    // ── FIRMS: термоточки NASA VIIRS NRT (публичный CSV, ключ не нужен) ───────
    // Источник: https://firms.modaps.eosdis.nasa.gov/active_fire/
    // Обновляется каждые ~3 часа, покрывает 24 часа детекций
    fetch('/api/monitoring/fire-hotspots/firms')
      .then(r => r.json())
      .then(res => {
        if (!alive || !res.success || !res.geojson?.features?.length) return;

        const features: any[] = res.geojson.features;
        const high = features.filter(f => f.properties?.confidence === 'high').length;
        setHotspotStats({ count: features.length, high });

        const fireIconNormal = L.divIcon({
          className: '',
          html: '<div style="width:8px;height:8px;background:#ef4444;border-radius:50%;border:1.5px solid #fbbf24;box-shadow:0 0 5px rgba(239,68,68,0.7);"></div>',
          iconSize: [8, 8], iconAnchor: [4, 4],
        });
        const fireIconHigh = L.divIcon({
          className: '',
          html: '<div style="width:12px;height:12px;background:#ef4444;border-radius:50%;border:2px solid #fbbf24;box-shadow:0 0 8px rgba(239,68,68,0.9);"></div>',
          iconSize: [12, 12], iconAnchor: [6, 6],
        });

        L.geoJSON(res.geojson, {
          pointToLayer: (feature, latlng) =>
            L.marker(latlng, { icon: feature.properties?.confidence === 'high' ? fireIconHigh : fireIconNormal }),
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            const confLabel = p.confidence === 'high' ? '🔴 Высокая' : p.confidence === 'nominal' ? '🟡 Средняя' : '🟢 Низкая';
            layer.bindPopup(`
              <div style="min-width:190px">
                <h3 style="font-weight:bold;color:#ef4444;margin-bottom:6px">🔥 Термоточка FIRMS</h3>
                <p><strong>Источник:</strong> NASA VIIRS NRT</p>
                <p><strong>Спутник:</strong> ${p.satellite === 'N' ? 'NOAA-20 VIIRS' : p.satellite === 'S' ? 'Suomi NPP VIIRS' : p.satellite}</p>
                <p><strong>Дата:</strong> ${p.acq_date} ${p.acq_time ? p.acq_time.slice(0,2)+':'+p.acq_time.slice(2) : ''} UTC</p>
                <p><strong>FRP:</strong> ${Number(p.frp).toFixed(1)} МВт</p>
                <p><strong>Яркость:</strong> ${Number(p.brightness).toFixed(0)} K</p>
                <p><strong>Достоверность:</strong> ${confLabel}</p>
              </div>
            `);
          },
        }).addTo(firmsGroup);
      })
      .catch(err => console.warn('FIRMS fetch failed:', err));

    return () => {
      alive = false;
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [searchParams]);

  const fmt = (n: number, d = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });

  return (
    <div className="px-4 py-8">
      <div className="max-w-7xl mx-auto">

        {/* Status */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`w-3 h-3 rounded-full ${
            apiStatus === 'online' ? 'bg-green-500' :
            apiStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'
          }`} />
          <span className="text-sm text-gray-400">
            API: {apiStatus === 'online' ? 'Подключено' : apiStatus === 'offline' ? 'Недоступно' : 'Проверка...'}
          </span>
        </div>

        {/* Рослесхоз official stats */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-gray-300">Рослесхоз — официальная статистика</span>
            <a href="https://rosleshoz.gov.ru/opendata/" target="_blank" rel="noopener noreferrer"
              className="text-xs text-green-400 bg-green-900/30 border border-green-800/50 px-2 py-0.5 rounded-full hover:bg-green-900/50 transition-colors">
              rosleshoz.gov.ru/opendata
            </a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {rosleshoz ? (
              <>
                <div className="card p-4 text-center">
                  <p className="text-xl font-bold text-green-300">{fmt(rosleshoz.total_forestland_area_thousand_ha)} тыс. га</p>
                  <p className="text-xs text-gray-400 mt-1">Площадь лесных земель РФ</p>
                </div>
                <div className="card p-4 text-center">
                  <p className="text-xl font-bold text-blue-300">{fmt(rosleshoz.total_wood_volume_thousand_m3)} тыс. м³</p>
                  <p className="text-xs text-gray-400 mt-1">Заготовка древесины (год)</p>
                </div>
                <div className="card p-4 text-center">
                  <p className="text-xl font-bold text-emerald-300">
                    {rosleshoz.reforestation_latest ? `${fmt(rosleshoz.reforestation_latest.area_thousand_ha, 1)} тыс. га` : '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Лесовосстановление{rosleshoz.reforestation_latest ? ` (${rosleshoz.reforestation_latest.year})` : ''}
                  </p>
                </div>
                <div className="card p-4 text-center">
                  <p className="text-xl font-bold text-red-300">{fmt(rosleshoz.fires_area_thousand_ha, 1)} тыс. га</p>
                  <p className="text-xs text-gray-400 mt-1">Площадь пожаров (лесфонд)</p>
                </div>
              </>
            ) : (
              [...Array(4)].map((_, i) => (
                <div key={i} className="card p-4 text-center animate-pulse">
                  <div className="h-6 bg-gray-700 rounded mx-auto w-2/3 mb-2" />
                  <div className="h-3 bg-gray-800 rounded mx-auto w-3/4" />
                </div>
              ))
            )}
          </div>
        </div>


        {/* Recent incidents */}
        {recentIncidents.length > 0 && <section className="mb-8">
          <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">Последние события</h2><p className="mt-1 text-sm text-slate-400">Свежие изменения из системы мониторинга</p></div><Link to="/incidents" className="text-sm text-green-400 hover:text-green-300">Все инциденты →</Link></div>
          <div className="grid gap-5 md:grid-cols-3">{recentIncidents.map(item => <IncidentCard key={item.id} incident={item} onClick={() => { window.location.href = `/incidents?id=${item.id}`; }} />)}</div>
        </section>}

        {/* Map */}
        <div className="card overflow-hidden">
          <div ref={mapRef} className="h-[620px] w-full" />
        </div>

        {/* Data sources footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
            <span>Потери леса: <a href="https://www.globalforestwatch.org" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">Hansen/UMD · GFW</a></span>
            <span>·</span>
            <span>ООПТ: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">OSM © contributors (ODbL)</a></span>
            <span>·</span>
            <span>Пожары: <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">NASA FIRMS VIIRS</a></span>
            <span>·</span>
            <span>Статистика: <a href="https://rosleshoz.gov.ru/opendata/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">Рослесхоз opendata</a></span>
          </div>
          <a href="/api/external/sources" target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-400 transition-colors">
            Все источники →
          </a>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
