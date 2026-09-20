import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Incident } from '../api/incidents';
import { getIncidentStatus, incidentTypes } from './IncidentCard';
import { serializeIncident } from '../utils/incidents';

export default function IncidentModal({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const navigate = useNavigate();
  const type = incidentTypes[incident.change_type] || incidentTypes.other;
  const status = getIncidentStatus(incident);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([serializeIncident(incident)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `incident-${incident.id}.json`; link.click();
    URL.revokeObjectURL(url);
  };
  const showOnMap = () => {
    const params = new URLSearchParams();
    if (incident.center_lat != null) params.set('lat', String(incident.center_lat));
    if (incident.center_lng != null) params.set('lng', String(incident.center_lng));
    params.set('incident', String(incident.id));
    navigate(`/?${params}`);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="incident-title" className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-0">
        <header className={`flex items-start justify-between border-b border-slate-700 p-6 ${type.color}`}>
          <div className="flex gap-3"><span className="text-3xl">{type.icon}</span><div><h2 id="incident-title" className="text-xl font-bold">{type.label}</h2><p className="text-sm text-slate-400">Событие #{incident.id}</p></div></div>
          <button onClick={onClose} aria-label="Закрыть" className="text-2xl text-slate-400 hover:text-white">×</button>
        </header>
        <div className="p-6">
          <div className="mb-6 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-sm ${status.style}`}>{status.label}</span>{incident.severity && <span className="rounded-full bg-slate-700 px-3 py-1 text-sm">Важность: {incident.severity}</span>}</div>
          <dl className="grid gap-5 sm:grid-cols-2">
            {[
              ['Регион', incident.region || incident.forest_area_name || 'Не определён'],
              ['Дата обнаружения', new Date(incident.detected_date).toLocaleString('ru-RU')],
              ['Координаты', incident.center_lat != null && incident.center_lng != null ? `${Number(incident.center_lat).toFixed(5)}, ${Number(incident.center_lng).toFixed(5)}` : '—'],
              ['Площадь', incident.area_ha == null ? '—' : `${Number(incident.area_ha).toLocaleString('ru-RU')} га`],
              ['Источник', incident.source || 'БД мониторинга'],
              ['Спутник', incident.satellite || '—'],
              ['Уверенность', incident.confidence == null ? '—' : `${Math.round(Number(incident.confidence) * 100)}%`],
              ['Подтверждено', incident.confirmed_date ? new Date(incident.confirmed_date).toLocaleDateString('ru-RU') : 'Нет'],
            ].map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{value}</dd></div>)}
          </dl>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button onClick={showOnMap} disabled={incident.center_lat == null || incident.center_lng == null} className="btn-primary disabled:cursor-not-allowed disabled:opacity-40">Показать на карте</button>
            <button onClick={download} className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-700">Скачать данные (JSON)</button>
          </div>
        </div>
      </section>
    </div>
  );
}