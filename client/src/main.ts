import './style.css';

import { checkHealth } from './api/health';
import { updateStatus } from './components/StatusIndicator';
import { initializeMap } from './components/MapContainer';
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

function initializeMapPlaceholder(): void {
  const mapContainer = document.getElementById('map-container');
  if (mapContainer) {
    initializeMap('map-container', {
      center: [53.5, 108.0],
      zoom: 7,
    });
  }
}

function initializeNavigation(): void {
  devAlert(AlertLevel.TODO, 'Implement navigation click handlers', 'main.ts');
  
  const navLinks = document.querySelectorAll('nav a[href^="#"]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href')?.slice(1);
      if (targetId) {
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.scrollIntoView({ behavior: 'smooth' });
        } else {
          devAlert(AlertLevel.WARNING, `Section #${targetId} not found`, 'main.ts');
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
      alert('Экспорт данных находится в разработке.\n\nTODO: Реализовать экспорт в форматах PDF, Excel, GeoJSON');
    });
  }
}

async function initialize(): Promise<void> {
  console.log('Baikal Forest Monitoring System initialized');
  
  await initializeHealthCheck();
  initializeMapPlaceholder();
  initializeNavigation();
  initializeExportButton();
  
  if (import.meta.env.DEV) {
    showAlertsSummary();
  }
}

document.addEventListener('DOMContentLoaded', initialize);
