import type { Incident } from '../api/incidents';

export const incidentTypes: Record<string, { label: string; icon: string; color: string }> = {
  fire: { label: 'Пожар', icon: '🔥', color: 'border-red-500/50 bg-red-500/10' },
  logging: { label: 'Вырубка', icon: '🪓', color: 'border-amber-500/50 bg-amber-500/10' },
  disease: { label: 'Повреждение', icon: '🍂', color: 'border-violet-500/50 bg-violet-500/10' },
  windfall: { label: 'Повреждение', icon: '🌬️', color: 'border-blue-500/50 bg-blue-500/10' },
  regrowth: { label: 'Восстановление', icon: '🌱', color: 'border-green-500/50 bg-green-500/10' },
  other: { label: 'Изменение', icon: '◉', color: 'border-slate-500/50 bg-slate-500/10' },
};

export function getIncidentStatus(incident: Incident) {
  if (incident.confirmed_date) return { label: 'Подтверждено', style: 'bg-green-500/15 text-green-300' };
  if (incident.severity === 'high' || incident.severity === 'critical') {
    return { label: 'Обрабатывается', style: 'bg-amber-500/15 text-amber-300' };
  }
  return { label: 'Обнаружено', style: 'bg-blue-500/15 text-blue-300' };
}

const number = (value: number | string | null | undefined) =>
  value == null ? null : Number(value);

export default function IncidentCard({ incident, onClick }: { incident: Incident; onClick: () => void }) {
  const type = incidentTypes[incident.change_type] || incidentTypes.other;
  const status = getIncidentStatus(incident);
  const confidence = number(incident.confidence);
  const area = number(incident.area_ha);

  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-5 transition hover:-translate-y-1 hover:border-slate-400 ${type.color}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>{type.icon}</span>
          <div><p className="font-semibold text-white">{type.label}</p><p className="text-xs text-slate-400">Событие #{incident.id}</p></div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${status.style}`}>{status.label}</span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
        <div className="col-span-2"><dt className="text-xs text-slate-500">Регион</dt><dd className="mt-1 text-slate-200">{incident.region || incident.forest_area_name || 'Не определён'}</dd></div>
        <div><dt className="text-xs text-slate-500">Обнаружено</dt><dd className="mt-1 text-slate-200">{new Date(incident.detected_date).toLocaleDateString('ru-RU')}</dd></div>
        <div><dt className="text-xs text-slate-500">Площадь</dt><dd className="mt-1 text-slate-200">{area == null ? '—' : `${area.toLocaleString('ru-RU')} га`}</dd></div>
        <div><dt className="text-xs text-slate-500">Источник</dt><dd className="mt-1 text-slate-200">{incident.source || incident.satellite || 'БД'}</dd></div>
        <div><dt className="text-xs text-slate-500">Уверенность</dt><dd className="mt-1 text-slate-200">{confidence == null ? '—' : `${Math.round(confidence * 100)}%`}</dd></div>
      </dl>
    </button>
  );
}