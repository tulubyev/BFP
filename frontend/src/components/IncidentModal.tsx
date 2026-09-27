import { useEffect } from 'react';
import type { Incident } from '../api/incidents';
import { getIncidentStatus, incidentTypeOf } from './IncidentCard';
import IncidentImagery from './IncidentImagery';
import NdviSeries from './NdviSeries';
import IncidentLocation from './IncidentLocation';
import { canRequestImagery } from '../utils/imagery';
import {
  FIRMS_AREA_NOTE, STATIC_SOURCE_LABEL, detectedDateLabel, firmsIncidentInfo, formatDateTime, incidentTitle, probableCause,
  serializeIncident, staticSourceNote,
} from '../utils/incidents';

export default function IncidentModal({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const type = incidentTypeOf(incident);
  const status = getIncidentStatus(incident);
  const firms = firmsIncidentInfo(incident);
  const title = incidentTitle(incident, type.label);
  const cause = probableCause(incident);
  const rows: [string, string][] = firms ? [
    ['Регион', incident.region || 'Не определён'],
    ['Дата обнаружения', detectedDateLabel(incident)],
    ['Координаты центра', incident.center_lat != null && incident.center_lng != null ? `${Number(incident.center_lat).toFixed(5)}, ${Number(incident.center_lng).toFixed(5)}` : '—'],
    ['Площадь', incident.area_ha == null ? '—' : `до ${Number(incident.area_ha).toLocaleString('ru-RU')} га (${FIRMS_AREA_NOTE})`],
    ['Источник', firms.sourceLabel],
    ['Спутники', incident.satellite || '—'],
    ['Статус', firms.staticSource
      ? `${STATIC_SOURCE_LABEL}. ${staticSourceNote(incident)}`
      : firms.active ? 'Активен — новые точки за последние 48 ч' : 'Затих — новых точек нет более 48 ч'],
    ['Первая точка', formatDateTime(firms.firstSeen)],
    ['Последняя точка', formatDateTime(firms.lastSeen)],
    ['Макс. мощность (FRP)', firms.frpMax == null ? '—' : `${firms.frpMax.toLocaleString('ru-RU')} МВт`],
    ['Точки высокой достоверности', incident.confidence == null ? '—' : `${Math.round(Number(incident.confidence) * 100)}%`],
  ] : [
    ['Регион', incident.region || incident.forest_area_name || 'Не определён'],
    ['Дата обнаружения', new Date(incident.detected_date).toLocaleString('ru-RU')],
    ['Координаты', incident.center_lat != null && incident.center_lng != null ? `${Number(incident.center_lat).toFixed(5)}, ${Number(incident.center_lng).toFixed(5)}` : '—'],
    ['Площадь', incident.area_ha == null ? '—' : `${Number(incident.area_ha).toLocaleString('ru-RU')} га`],
    ['Источник', incident.source || 'БД мониторинга'],
    ['Спутник', incident.satellite || '—'],
    ['Уверенность', incident.confidence == null ? '—' : `${Math.round(Number(incident.confidence) * 100)}%`],
    ['Подтверждено', incident.confirmed_date ? new Date(incident.confirmed_date).toLocaleDateString('ru-RU') : 'Нет'],
  ];
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

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="incident-title" className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-0">
        <header className={`flex items-start justify-between border-b border-slate-700 p-6 ${type.color}`}>
          <div className="flex gap-3"><span className="text-3xl">{type.icon}</span><div><h2 id="incident-title" className="text-xl font-bold">{title}</h2><p className="text-sm text-slate-400">Событие #{incident.id}{cause && <> · {cause}</>}</p></div></div>
          <button onClick={onClose} aria-label="Закрыть" className="text-2xl text-slate-400 hover:text-white">×</button>
        </header>
        <div className="p-6">
          <div className="mb-6 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-sm ${status.style}`}>{status.label}</span>{incident.severity && <span className="rounded-full bg-slate-700 px-3 py-1 text-sm">Важность: {incident.severity}</span>}</div>
          <dl className="grid gap-5 sm:grid-cols-2">
            {rows.map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-slate-200">{value}</dd></div>)}
          </dl>
          <IncidentLocation incident={incident} />
          {canRequestImagery(incident) && <IncidentImagery incidentId={incident.id} />}
          {/* The series needs an incident outline: FIRMS incidents only */}
          {firms && canRequestImagery(incident) && <NdviSeries incidentId={incident.id} />}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button onClick={download} className="rounded-lg border border-slate-600 px-4 py-2 hover:bg-slate-700">Скачать данные (JSON)</button>
          </div>
          <details className="mt-6 rounded-lg border border-slate-700">
            <summary className="cursor-pointer px-4 py-3 text-sm text-slate-300 hover:text-white">Исходные данные (JSON)</summary>
            <pre className="max-h-80 overflow-auto border-t border-slate-700 p-4 text-xs text-slate-300">{serializeIncident(incident)}</pre>
          </details>
        </div>
      </section>
    </div>
  );
}