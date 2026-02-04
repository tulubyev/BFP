const isDevelopment = import.meta.env.DEV;

export enum AlertLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  TODO = 'TODO',
  STUB = 'STUB',
  CRITICAL = 'CRITICAL'
}

interface DevAlert {
  level: AlertLevel;
  message: string;
  file?: string;
  timestamp: Date;
}

const alerts: DevAlert[] = [];

export function devAlert(level: AlertLevel, message: string, file?: string): void {
  if (!isDevelopment) return;
  
  const alert: DevAlert = { level, message, file, timestamp: new Date() };
  alerts.push(alert);
  
  const prefix = `[${level}]`;
  const location = file ? ` (${file})` : '';
  
  switch (level) {
    case AlertLevel.CRITICAL:
      console.error(`%c${prefix}${location}: ${message}`, 'color: red; font-weight: bold');
      break;
    case AlertLevel.WARNING:
      console.warn(`%c${prefix}${location}: ${message}`, 'color: orange');
      break;
    case AlertLevel.TODO:
      console.warn(`%c${prefix}${location}: ${message}`, 'color: yellow');
      break;
    case AlertLevel.STUB:
      console.info(`%c${prefix}${location}: ${message}`, 'color: cyan');
      break;
    default:
      console.log(`${prefix}${location}: ${message}`);
  }
}

export function todo(message: string, file?: string): void {
  devAlert(AlertLevel.TODO, message, file);
}

export function stub(functionName: string, file?: string): void {
  devAlert(AlertLevel.STUB, `Function '${functionName}' is a stub - implementation needed`, file);
}

export function needsWork(area: string, description: string, file?: string): void {
  devAlert(AlertLevel.WARNING, `${area}: ${description}`, file);
}

export function getAlerts(): DevAlert[] {
  return [...alerts];
}

export function showAlertsSummary(): void {
  if (!isDevelopment || alerts.length === 0) return;
  
  console.group('Development Alerts Summary');
  console.log(`Total alerts: ${alerts.length}`);
  
  const byLevel = alerts.reduce((acc, alert) => {
    acc[alert.level] = (acc[alert.level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  Object.entries(byLevel).forEach(([level, count]) => {
    console.log(`  ${level}: ${count}`);
  });
  console.groupEnd();
}

export default { devAlert, todo, stub, needsWork, getAlerts, showAlertsSummary };
