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
      .then(data => setStatistics(data))
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
