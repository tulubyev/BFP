import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Statistics {
  forestAreas: number;
  forestChanges: number;
  fireHotspots: number;
  monitoringZones: number;
}

function HomePage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
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
            monitoringZones: response.data.active_alerts?.length || 0
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
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([53.5, 108.0], 7);
    mapInstanceRef.current = map;

    const baseLayers: Record<string, L.TileLayer> = {
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }),
      'ESRI Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
      }),
      'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap'
      }),
      'CartoDB Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
      })
    };

    const overlayLayers: Record<string, L.TileLayer> = {
      'Гибридный (подписи)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
      }),
      'Административные границы': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
      }),
      'Дороги': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri'
      }),
      'Населённые пункты': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB'
      })
    };

    baseLayers['OpenStreetMap'].addTo(map);
    L.control.layers(baseLayers, overlayLayers).addTo(map);

    fetch('/api/monitoring/forest-areas/geojson')
      .then(res => res.json())
      .then(geojson => {
        const forestLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const status = feature?.properties?.protection_status;
            return {
              color: status === 'reserve' ? '#22c55e' : '#3b82f6',
              weight: 2,
              fillOpacity: 0.3,
              fillColor: status === 'reserve' ? '#22c55e' : '#3b82f6'
            };
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties;
            layer.bindPopup(`
              <div style="min-width: 200px">
                <h3 style="font-weight: bold; margin-bottom: 8px">${props.name}</h3>
                <p><strong>Регион:</strong> ${props.region}</p>
                <p><strong>Тип леса:</strong> ${props.forest_type === 'coniferous' ? 'Хвойный' : 'Смешанный'}</p>
                <p><strong>Площадь:</strong> ${Number(props.area_ha).toLocaleString()} га</p>
                <p><strong>Статус:</strong> ${props.protection_status === 'reserve' ? 'Заповедник' : 'Национальный парк'}</p>
              </div>
            `);
          }
        });
        forestLayer.addTo(map);
      })
      .catch(console.error);

    fetch('/api/monitoring/fire-hotspots/firms')
      .then(res => res.json())
      .then(response => {
        if (response.success && response.geojson) {
          const fireIcon = L.divIcon({
            className: 'fire-marker',
            html: '<div style="width: 16px; height: 16px; background: #ef4444; border-radius: 50%; border: 2px solid #fbbf24; box-shadow: 0 0 8px #ef4444;"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          const fireLayer = L.geoJSON(response.geojson, {
            pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: fireIcon }),
            onEachFeature: (feature, layer) => {
              const props = feature.properties;
              const confidence = props.confidence === 'high' ? 'Высокая' : props.confidence === 'nominal' ? 'Средняя' : 'Низкая';
              layer.bindPopup(`
                <div style="min-width: 180px">
                  <h3 style="font-weight: bold; color: #ef4444; margin-bottom: 8px">🔥 Термоточка</h3>
                  <p><strong>Спутник:</strong> ${props.satellite}</p>
                  <p><strong>Дата:</strong> ${props.acq_date}</p>
                  <p><strong>Время:</strong> ${props.acq_time}</p>
                  <p><strong>Яркость:</strong> ${props.brightness}K</p>
                  <p><strong>Мощность:</strong> ${props.frp} MW</p>
                  <p><strong>Достоверность:</strong> ${confidence}</p>
                </div>
              `);
            }
          });
          fireLayer.addTo(map);
        }
      })
      .catch(console.error);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div className="px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <div className={`w-3 h-3 rounded-full ${
            apiStatus === 'online' ? 'bg-green-500' : 
            apiStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
          }`} />
          <span className="text-sm text-gray-400">
            API: {apiStatus === 'online' ? 'Подключено' : apiStatus === 'offline' ? 'Недоступно' : 'Проверка...'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{statistics?.forestAreas ?? '-'}</p>
            <p className="text-xs text-gray-400">Лесных участков</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-orange-400">{statistics?.forestChanges ?? '-'}</p>
            <p className="text-xs text-gray-400">Изменений</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{statistics?.fireHotspots ?? '-'}</p>
            <p className="text-xs text-gray-400">Термоточек</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{statistics?.monitoringZones ?? '-'}</p>
            <p className="text-xs text-gray-400">Зон мониторинга</p>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div ref={mapRef} className="h-[600px] w-full" />
        </div>
      </div>
    </div>
  );
}

export default HomePage;
