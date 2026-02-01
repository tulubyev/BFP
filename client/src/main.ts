import './style.css';

interface HealthResponse {
  status: string;
  timestamp: string;
}

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch('/health');
    const data: HealthResponse = await response.json();
    console.log('Server health:', data);
    
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
      statusEl.textContent = `Server: ${data.status}`;
      statusEl.classList.add('text-green-400');
    }
  } catch (error) {
    console.error('Health check failed:', error);
    const statusEl = document.getElementById('server-status');
    if (statusEl) {
      statusEl.textContent = 'Server: Offline';
      statusEl.classList.add('text-red-400');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
});

console.log('Baikal Forest Monitoring System initialized');
