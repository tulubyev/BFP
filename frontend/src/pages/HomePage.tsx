import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Statistics {
  forestAreas: number;
  forestChanges: number;
  fireHotspots: number;
  monitoringZones: number;
}

interface RosleskhozSummary {
  total_wood_volume_thousand_m3: number;
  total_forestland_area_thousand_ha: number;
  reforestation_latest: { year: number; area_thousand_ha: number } | null;
  fires_area_thousand_ha: number;
}

const TRANSPARENT_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: '', shadowUrl: '', iconRetinaUrl: '' });

function addMapLegend(map: L.Map): L.Control {
  const Legend = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', '');
      div.style.cssText = [
        'background:rgba(15,23,42,0.92)',
        'border:1px solid #334155',
        'border-radius:8px',
        'padding:10px 14px',
        'font-size:12px',
        'color:#cbd5e1',
        'min-width:200px',
        'pointer-events:auto',
        'backdrop-filter:blur(4px)',
      ].join(';');

      div.innerHTML = `
        <p style="font-weight:700;color:#fff;margin:0 0 8px 0;font-size:13px">Легенда</p>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:4px;background:#ef4444;border-radius:2px;display:inline-block"></span>
            <span>Потери леса 2001–2023 (GFW)</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:4px;background:#f97316;border-radius:2px;display:inline-block"></span>
            <span>GLAD-алерты вырубок</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:16px;background:rgba(34,197,94,0.45);border:2px solid #22c55e;border-radius:2px;display:inline-block"></span>
            <span>Заповедник / нац. парк</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:16px;background:rgba(59,130,246,0.35);border:2px solid #3b82f6;border-radius:2px;display:inline-block"></span>
            <span>Лесной фонд</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:16px;background:rgba(234,179,8,0.25);border:2px dashed #eab308;border-radius:2px;display:inline-block"></span>
            <span>Зона мониторинга</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:16px;height:16px;background:#ef4444;border:2px solid #fbbf24;border-radius:50%;display:inline-block"></span>
            <span>Термоточка FIRMS (NASA)</span>
          </div>
          <hr style="border:none;border-top:1px solid #334155;margin:4px 0"/>
          <p style="font-size:10px;color:#64748b;margin:0">Hansen/UMD · GFW · NASA FIRMS · Рослесхоз</p>
        </div>
      `;
      return div;
    },
  });
  const legend = new Legend();
  legend.addTo(map);
  return legend;
}

function HomePage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [rosleshoz, setRosleshoz] = useState<RosleskhozSummary | null>(null);
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'offline'>('loading');

  useEffect(() => {
    fetch('/health')
      .then(res => res.json())
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'));

    fetch('/api/monitoring/statistics')
      .then(res => res.json())
      .then(response => {
        if (response.success && response.data) {
          setStatistics({
            forestAreas: parseInt(response.data.forest_areas?.count) || 0,
            forestChanges: response.data.changes_by_type?.length || 0,
            fireHotspots: parseInt(response.data.recent_fires_7d) || 0,
            monitoringZones: response.data.active_alerts?.length || 0,
          });
        }
      })
      .catch(console.error);

    fetch('/api/monitoring/fire-hotspots/firms')
      .then(res => res.json())
      .then(response => {
        if (response.success) {
          setStatistics(prev => prev ? { ...prev, fireHotspots: response.count || 0 } : null);
        }
      })
      .catch(console.error);

    // Рослесхоз official statistics
    fetch('/api/external/rosleshoz/summary')
      .then(res => res.json())
      .then(response => {
        if (response.success && response.data) {
          setRosleshoz(response.data);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([53.5, 108.0], 5);
    mapInstanceRef.current = map;
    let alive = true;

    // ── Base layers ─────────────────────────────────────────────────────────
    const baseLayers: Record<string, L.TileLayer> = {
      'CartoDB Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB',
        maxZoom: 19,
      }),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }),
      'ESRI Спутник': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 19,
      }),
      'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap',
        maxZoom: 17,
      }),
    };

    baseLayers['CartoDB Dark'].addTo(map);

    // ── GFW: потери леса (Hansen/UMD, 30m, 2001–2023) ───────────────────────
    const gfwLossTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.9/tcd_30/{z}/{x}/{y}.png',
      {
        attribution: '© Hansen/UMD/Google/USGS/NASA via GFW',
        opacity: 0.85,
        maxZoom: 16,
        minZoom: 3,
        errorTileUrl: TRANSPARENT_TILE,
      }
    );

    // ── GFW: GLAD Landsat Deforestation Alerts (еженедельное обновление) ─────
    const gladAlertsTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_glad_landsat_alerts/v20230224/dynamic/{z}/{x}/{y}.png?implementation=default',
      {
        attribution: '© GLAD/UMD via GFW',
        opacity: 0.9,
        maxZoom: 16,
        minZoom: 3,
        errorTileUrl: TRANSPARENT_TILE,
      }
    );

    // ── GFW: плотность лесного покрова ──────────────────────────────────────
    const gfwDensityTiles = L.tileLayer(
      'https://tiles.globalforestwatch.org/umd_tree_cover/v1.9/tcd_30/{z}/{x}/{y}.png',
      {
        attribution: '© Hansen/UMD/Google/USGS/NASA via GFW',
        opacity: 0.6,
        maxZoom: 16,
        minZoom: 3,
        errorTileUrl: TRANSPARENT_TILE,
      }
    );

    // ── ФГИС ЛК: официальный лесной кадастр (WMS) ───────────────────────────
    const fgisLkWMS = (L.tileLayer as any).wms
      ? (L.tileLayer as any).wms(
          'https://pub.fgislk.gov.ru/plk/geoservermaster/geoserver/ows',
          {
            layers: 'plk:plk_les_use',
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            attribution: '© ФГИС ЛК / Рослесхоз',
            opacity: 0.6,
            errorTileUrl: TRANSPARENT_TILE,
          }
        )
      : null;

    // ── Esri: административные границы и дороги ──────────────────────────────
    const adminBoundaries = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    );
    const roadLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    );

    // ── Layer control ────────────────────────────────────────────────────────
    const overlayLayers: Record<string, L.Layer> = {
      'Потери леса (GFW 2001–2023)': gfwLossTiles,
      'GLAD-алерты вырубок (GFW)': gladAlertsTiles,
      'Лесной покров (GFW)': gfwDensityTiles,
      'Административные границы': adminBoundaries,
      'Дороги': roadLayer,
    };

    if (fgisLkWMS) {
      overlayLayers['ФГИС ЛК — лесопользование'] = fgisLkWMS;
    }

    gfwLossTiles.addTo(map);
    gladAlertsTiles.addTo(map);

    const layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
    addMapLegend(map);

    // ── Forest areas from DB ─────────────────────────────────────────────────
    fetch('/api/monitoring/forest-areas/geojson')
      .then(res => res.json())
      .then(geojson => {
        if (!alive) return;
        const forestLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const status = feature?.properties?.protection_status;
            return {
              color: status === 'reserve' ? '#22c55e' : '#3b82f6',
              weight: 2,
              fillOpacity: 0.3,
              fillColor: status === 'reserve' ? '#22c55e' : '#3b82f6',
            };
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layer.bindPopup(`
              <div style="min-width:200px">
                <h3 style="font-weight:bold;margin-bottom:8px">${p.name}</h3>
                <p><strong>Регион:</strong> ${p.region}</p>
                <p><strong>Тип леса:</strong> ${p.forest_type === 'coniferous' ? 'Хвойный' : 'Смешанный'}</p>
                <p><strong>Площадь:</strong> ${Number(p.area_ha).toLocaleString()} га</p>
                <p><strong>Статус:</strong> ${p.protection_status === 'reserve' ? 'Заповедник' : 'Нац. парк'}</p>
              </div>
            `);
          },
        });
        overlayLayers['Лесные участки (БД)'] = forestLayer;
        forestLayer.addTo(map);
        layerControl.addOverlay(forestLayer, 'Лесные участки (БД)');
      })
      .catch(console.error);

    // ── Monitoring zones from DB ──────────────────────────────────────────────
    fetch('/api/monitoring/monitoring-zones')
      .then(res => res.json())
      .then(response => {
        if (!alive || !response.success || !response.data?.length) return;

        const ZONE_COLORS: Record<string, string> = {
          fire_risk:    '#ef4444',
          logging:      '#f97316',
          restoration:  '#22c55e',
          biodiversity: '#8b5cf6',
          water:        '#3b82f6',
        };
        const ZONE_LABELS: Record<string, string> = {
          fire_risk:    'Пожарный риск',
          logging:      'Лесозаготовка',
          restoration:  'Восстановление',
          biodiversity: 'Биоразнообразие',
          water:        'Водоохранная зона',
        };

        const zonesFeatures = response.data
          .filter((z: any) => z.geojson)
          .map((z: any) => ({
            type: 'Feature',
            geometry: JSON.parse(z.geojson),
            properties: z,
          }));

        const zonesLayer = L.geoJSON({ type: 'FeatureCollection', features: zonesFeatures } as any, {
          style: (feature) => {
            const color = ZONE_COLORS[feature?.properties?.zone_type] ?? '#eab308';
            return { color, weight: 2, dashArray: '6 4', fillColor: color, fillOpacity: 0.12 };
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            const label = ZONE_LABELS[p.zone_type] ?? p.zone_type;
            const priority = p.priority === 'high' ? '🔴 Высокий' : p.priority === 'medium' ? '🟡 Средний' : '🟢 Низкий';
            layer.bindPopup(`
              <div style="min-width:200px">
                <h3 style="font-weight:bold;margin-bottom:6px">${p.name}</h3>
                <p><strong>Тип:</strong> ${label}</p>
                <p><strong>Приоритет:</strong> ${priority}</p>
                <p><strong>Мониторинг:</strong> ${p.monitoring_frequency}</p>
                ${p.description ? `<p style="font-size:11px;color:#888;margin-top:4px">${p.description}</p>` : ''}
              </div>
            `);
          },
        });

        overlayLayers['Зоны мониторинга (БД)'] = zonesLayer;
        zonesLayer.addTo(map);
        layerControl.addOverlay(zonesLayer, 'Зоны мониторинга (БД)');
      })
      .catch(console.error);

    // ── FIRMS fire hotspots ──────────────────────────────────────────────────
    fetch('/api/monitoring/fire-hotspots/firms')
      .then(res => res.json())
      .then(response => {
        if (!alive || !response.success || !response.geojson) return;

        const fireIcon = L.divIcon({
          className: 'fire-marker',
          html: '<div style="width:14px;height:14px;background:#ef4444;border-radius:50%;border:2px solid #fbbf24;box-shadow:0 0 8px #ef4444;"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const fireLayer = L.geoJSON(response.geojson, {
          pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: fireIcon }),
          onEachFeature: (feature, layer) => {
            const p = feature.properties;
            const conf = p.confidence === 'high' ? 'Высокая' : p.confidence === 'nominal' ? 'Средняя' : 'Низкая';
            layer.bindPopup(`
              <div style="min-width:180px">
                <h3 style="font-weight:bold;color:#ef4444;margin-bottom:8px">🔥 Термоточка FIRMS</h3>
                <p><strong>Спутник:</strong> ${p.satellite}</p>
                <p><strong>Дата:</strong> ${p.acq_date}</p>
                <p><strong>Время:</strong> ${p.acq_time}</p>
                <p><strong>Яркость:</strong> ${p.brightness} K</p>
                <p><strong>Мощность:</strong> ${p.frp} MW</p>
                <p><strong>Достоверность:</strong> ${conf}</p>
                <p style="font-size:10px;color:#888;margin-top:4px">Источник: NASA FIRMS</p>
              </div>
            `);
          },
        });

        overlayLayers['Термоточки FIRMS (NASA)'] = fireLayer;
        fireLayer.addTo(map);
        layerControl.addOverlay(fireLayer, 'Термоточки FIRMS (NASA)');
      })
      .catch(console.error);

    return () => {
      alive = false;
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  const fmtNum = (n: number, decimals = 0) =>
    n.toLocaleString('ru-RU', { maximumFractionDigits: decimals });

  return (
    <div className="px-4 py-8">
      <div className="max-w-7xl mx-auto">

        {/* API status */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`w-3 h-3 rounded-full ${
            apiStatus === 'online' ? 'bg-green-500' :
            apiStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
          }`} />
          <span className="text-sm text-gray-400">
            API: {apiStatus === 'online' ? 'Подключено' : apiStatus === 'offline' ? 'Недоступно' : 'Проверка...'}
          </span>
        </div>

        {/* Real-time monitoring stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{statistics?.forestAreas ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">Лесных участков</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-orange-400">{statistics?.forestChanges ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">Изменений (БД)</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{statistics?.fireHotspots ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">Термоточек FIRMS</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{statistics?.monitoringZones ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-1">Зон мониторинга</p>
          </div>
        </div>

        {/* Рослесхоз official stats */}
        {rosleshoz && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Рослесхоз — официальные данные
              </span>
              <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">opendata</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card p-4 text-center border border-green-900/40">
                <p className="text-xl font-bold text-green-300">
                  {fmtNum(rosleshoz.total_forestland_area_thousand_ha)} тыс. га
                </p>
                <p className="text-xs text-gray-400 mt-1">Площадь лесных земель</p>
              </div>
              <div className="card p-4 text-center border border-blue-900/40">
                <p className="text-xl font-bold text-blue-300">
                  {fmtNum(rosleshoz.total_wood_volume_thousand_m3)} тыс. м³
                </p>
                <p className="text-xs text-gray-400 mt-1">Заготовка древесины (год)</p>
              </div>
              <div className="card p-4 text-center border border-emerald-900/40">
                <p className="text-xl font-bold text-emerald-300">
                  {rosleshoz.reforestation_latest
                    ? `${fmtNum(rosleshoz.reforestation_latest.area_thousand_ha, 1)} тыс. га`
                    : '—'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Лесовосстановление{rosleshoz.reforestation_latest ? ` (${rosleshoz.reforestation_latest.year})` : ''}
                </p>
              </div>
              <div className="card p-4 text-center border border-red-900/40">
                <p className="text-xl font-bold text-red-300">
                  {fmtNum(rosleshoz.fires_area_thousand_ha, 1)} тыс. га
                </p>
                <p className="text-xs text-gray-400 mt-1">Площадь пожаров (лесфонд)</p>
              </div>
            </div>
          </div>
        )}

        {/* Map */}
        <div className="card overflow-hidden">
          <div ref={mapRef} className="h-[600px] w-full" />
        </div>

        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-600">
            Слои: Hansen/UMD · GFW GLAD · NASA FIRMS · Рослесхоз · ФГИС ЛК
          </p>
          <a
            href="/api/external/sources"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-400 transition-colors"
          >
            Все источники данных →
          </a>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
