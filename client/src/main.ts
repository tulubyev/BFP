import './style.css';

import { checkHealth } from './api/health';
import { updateStatus } from './components/StatusIndicator';
import { 
  initializeMap, 
  loadForestAreas, 
  loadForestChanges, 
  loadFireHotspots,
  fitBounds,
  getMap 
} from './components/MapContainer';
import { showAlertsSummary, devAlert, AlertLevel } from './utils/devAlerts';

async function initializeHealthCheck(): Promise<void> {
  updateStatus('loading', 'Server: Checking...', {
    elementId: 'server-status',
    successClass: 'text-green-400',
    errorClass: 'text-red-400',
  });

  const result = await checkHealth();
  
  if (result.success && result.data) {
    console.log('Server health:', result.data);
    updateStatus('ok', `Server: ${result.data.status}`, {
      elementId: 'server-status',
      successClass: 'text-green-400',
      errorClass: 'text-red-400',
    });
  } else {
    console.error('Health check failed:', result.error);
    updateStatus('error', 'Server: Offline', {
      elementId: 'server-status',
      successClass: 'text-green-400',
      errorClass: 'text-red-400',
    });
  }
}

function initializeLeafletMap(): void {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;

  try {
    initializeMap('map-container', {
      center: [53.5, 108.0],
      zoom: 6,
    });
    console.log('Leaflet map initialized');
  } catch (error) {
    console.error('Failed to initialize map:', error);
    mapContainer.innerHTML = `
      <div class="flex items-center justify-center h-full bg-slate-800/50 rounded-lg">
        <div class="text-center p-8">
          <div class="text-6xl mb-4">🗺️</div>
          <h3 class="text-xl font-semibold text-white mb-2">Ошибка загрузки карты</h3>
          <p class="text-slate-400">Попробуйте перезагрузить страницу</p>
        </div>
      </div>
    `;
  }
}

function initializeMapButtons(): void {
  const btnLoadForests = document.getElementById('btn-load-forests');
  const btnLoadChanges = document.getElementById('btn-load-changes');
  const btnLoadFires = document.getElementById('btn-load-fires');
  const btnFitBaikal = document.getElementById('btn-fit-baikal');

  btnLoadForests?.addEventListener('click', async () => {
    const map = getMap();
    if (map) {
      btnLoadForests.textContent = 'Загрузка...';
      await loadForestAreas(map);
      btnLoadForests.textContent = '✓ Леса загружены';
    }
  });

  btnLoadChanges?.addEventListener('click', async () => {
    const map = getMap();
    if (map) {
      btnLoadChanges.textContent = 'Загрузка...';
      await loadForestChanges(map);
      btnLoadChanges.textContent = '✓ Изменения загружены';
    }
  });

  btnLoadFires?.addEventListener('click', async () => {
    const map = getMap();
    if (map) {
      btnLoadFires.textContent = 'Загрузка...';
      await loadFireHotspots(map, 30);
      btnLoadFires.textContent = '✓ Термоточки загружены';
    }
  });

  btnFitBaikal?.addEventListener('click', () => {
    fitBounds([[51.0, 100.0], [56.0, 112.0]]);
  });
}

function initializeNavigation(): void {
  const navLinks = document.querySelectorAll('nav a[href^="#"]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href')?.slice(1);
      if (targetId) {
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
}

function initializeExportButton(): void {
  devAlert(AlertLevel.TODO, 'Implement export functionality', 'main.ts');
  
  const exportBtn = document.getElementById('export-btn');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      alert('Экспорт данных находится в разработке.\n\nПланируется:\n- PDF отчёты\n- Excel таблицы\n- GeoJSON экспорт');
    });
  }
}

async function loadStatistics(): Promise<void> {
  try {
    const response = await fetch('/api/monitoring/statistics');
    const data = await response.json();
    
    if (data.success) {
      console.log('Statistics loaded:', data.data);
    }
  } catch (error) {
    console.warn('Failed to load statistics:', error);
  }
}

async function initialize(): Promise<void> {
  console.log('Baikal Forest Monitoring System initialized');
  
  await initializeHealthCheck();
  initializeLeafletMap();
  initializeMapButtons();
  initializeNavigation();
  initializeExportButton();
  
  await loadStatistics();
  
  if (import.meta.env.DEV) {
    showAlertsSummary();
  }
}

document.addEventListener('DOMContentLoaded', initialize);
