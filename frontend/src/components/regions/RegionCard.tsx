import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchRegionDetail, type Indicator, type RegionDetailResponse } from '../../api/regions';
import { NO_DATA, formatIndicatorValue, groupByKind } from '../../utils/regions';
import KindBadge from './KindBadge';

const GROUP_TITLES = {
  official: 'Официальные данные',
  satellite: 'Спутниковые наблюдения',
  estimate: 'Оценки',
} as const;

function IndicatorRow({ indicator }: { indicator: Indicator }) {
  const missing = indicator.value == null;
  return (
    <li className="border-t border-slate-700/60 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-white">{indicator.label}</span>
        <KindBadge kind={indicator.kind} />
      </div>
      <p className={`mt-1 text-lg ${missing ? 'text-gray-400' : 'text-white tabular-nums'}`}>
        {missing ? NO_DATA : formatIndicatorValue(indicator)}
      </p>
      {missing && indicator.reason && <p className="text-xs text-gray-400">Причина: {indicator.reason}</p>}
      {indicator.period && <p className="text-xs text-gray-400">Период: {indicator.period}</p>}
      <p className="mt-1 text-xs text-gray-500">{indicator.definition}</p>
      <p className="mt-1 text-xs text-gray-600">Источник: {indicator.source}</p>
    </li>
  );
}

function HotspotChart({ detail }: { detail: RegionDetailResponse }) {
  if (!detail.hotspotSeries.length) {
    return <p className="rounded-lg bg-slate-900/60 p-4 text-sm text-gray-400">Нет данных: {detail.hotspotSeriesReason ?? 'ряд пуст'}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={detail.hotspotSeries} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
          labelStyle={{ color: '#fff' }}
          labelFormatter={l => `${l} год`}
          formatter={v => Number(v).toLocaleString('ru-RU')}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
        <Bar dataKey="vegetation" name="Растительность" fill="#f97316" radius={[3, 3, 0, 0]} />
        <Bar dataKey="static" name="Статичные источники (факелы)" fill="#64748b" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: RegionDetailResponse };

export default function RegionCard({ iso, onClose }: { iso: string; onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchRegionDetail(iso)
      .then(detail => { if (!cancelled) setState({ status: 'ready', detail }); })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [iso]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  const detail = state.status === 'ready' ? state.detail : null;
  const groups = detail ? groupByKind([...detail.indicators, ...detail.extraIndicators]) : null;

  // Portal: the section's .card uses backdrop-filter, which would make it the containing block of `fixed`
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-2 sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="region-card-title" className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="region-card-title" className="text-xl font-bold text-white">{detail?.name ?? iso}</h3>
            {detail && (
              <p className="text-xs text-gray-400">
                {detail.iso} · площадь {detail.areaKm2.toLocaleString('ru-RU')} км² (по границам OSM) · данные собраны {new Date(detail.generatedAt).toLocaleString('ru-RU')}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-gray-400 hover:bg-slate-700 hover:text-white" aria-label="Закрыть">✕</button>
        </div>

        {state.status === 'loading' && <p className="py-10 text-center text-gray-400">Загрузка…</p>}
        {state.status === 'error' && <p className="py-10 text-center text-red-400">Нет данных: не удалось загрузить карточку субъекта ({state.message})</p>}

        {detail && groups && (
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-white">Термоточки по годам</h4>
                <KindBadge kind="satellite" />
              </div>
              <p className="mb-3 text-xs text-gray-500">
                VIIRS S-NPP, годовой архив NASA FIRMS{detail.archive ? ` (${detail.archive.years[0]}–${detail.archive.years[detail.archive.years.length - 1]})` : ''}.
                Растительность и статичные источники (газовые факелы, промышленность) показаны отдельно. Термоточка — не подтверждённый пожар.
              </p>
              <HotspotChart detail={detail} />
            </div>

            {(['official', 'satellite', 'estimate'] as const).map(kind => groups[kind].length > 0 && (
              <div key={kind}>
                <h4 className="mb-1 font-semibold text-white">{GROUP_TITLES[kind]}</h4>
                <ul>{groups[kind].map(ind => <IndicatorRow key={ind.id} indicator={ind} />)}</ul>
              </div>
            ))}

            <p className="rounded-lg bg-slate-900/60 p-3 text-xs text-gray-400">
              Сопоставление лесовосстановления и выбытия лесов по субъектам не проводится: региональных данных о
              восстановлении нет, методики учёта несовместимы. Потеря древесного покрова ≠ незаконная рубка.
            </p>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
