import { todo } from '../utils/devAlerts';

export interface StatusConfig {
  elementId: string;
  successClass: string;
  errorClass: string;
}

const defaultConfig: StatusConfig = {
  elementId: 'server-status',
  successClass: 'text-green-400',
  errorClass: 'text-red-400',
};

export function updateStatus(status: 'ok' | 'error' | 'loading', message: string, config = defaultConfig): void {
  const element = document.getElementById(config.elementId);
  if (!element) {
    console.warn(`Status element #${config.elementId} not found`);
    return;
  }
  
  element.textContent = message;
  element.classList.remove(config.successClass, config.errorClass, 'text-yellow-400');
  
  switch (status) {
    case 'ok':
      element.classList.add(config.successClass);
      break;
    case 'error':
      element.classList.add(config.errorClass);
      break;
    case 'loading':
      element.classList.add('text-yellow-400');
      break;
  }
}

export function createLoadingSpinner(): HTMLElement {
  todo('createLoadingSpinner: Add proper SVG spinner animation', 'components/StatusIndicator.ts');
  
  const spinner = document.createElement('div');
  spinner.className = 'animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500';
  return spinner;
}

export default { updateStatus, createLoadingSpinner };
