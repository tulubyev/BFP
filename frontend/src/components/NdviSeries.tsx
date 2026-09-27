import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getNdviSeries, ImageryApiError, type NdviSeries as Series } from '../api/imagery';
import { formatIndex } from '../utils/imagery';
import {
  SERIES_COLORS, SERIES_LABELS, SERIES_LINE_PROPS, SERIES_NOTE, SERIES_POLL_MS, SERIES_TITLE, missingYearNotes, progressText, seriesChartData,
  shouldPoll, yearTooltipLines, type ChartPoint,
} from '../utils/ndviSeries';

export type SeriesState =
  | { kind: 'loading' }
  | { kind: 'data'; data: Series; gaveUp: boolean }
  | { kind: 'error'; message: string };

/** Looks the year up by label: recharts passes no payload for a gap year, which still deserves its reason. */
function SeriesTooltip({ active, label, rows }: { active?: boolean; label?: number | string; rows: ChartPoint[] }) {
  const row = rows.find(r => r.year === Number(label));
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900 p-2 text-xs text-slate-200 shadow-lg">
      <p className="mb-1 font-semibold">{row.year}</p>
      {yearTooltipLines(row.point, row.year).map(line => <p key={line}>{line}</p>)}
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="20" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} /></svg>
      {label}
    </span>
  );
}

export function SeriesChart({ data }: { data: Series }) {
  const rows = seriesChartData(data.years);
  const values = rows.flatMap(r => [r.site, r.background]).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const lo = Math.floor(Math.min(...values) * 10) / 10;
  const hi = Math.ceil(Math.max(...values) * 10) / 10;
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-300">
        <LegendItem color={SERIES_COLORS.site} label={SERIES_LABELS.site} />
        <LegendItem color={SERIES_COLORS.background} label={SERIES_LABELS.background} dashed />
      </div>
      <div className="h-56 w-full" role="img" aria-label={`${SERIES_TITLE}: ${rows.map(r => `${r.year} — ${formatIndex(r.site)}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#475569' }} interval="preserveStartEnd" />
            <YAxis domain={[lo, hi]} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => formatIndex(Number(v))} width={48} />
            <Tooltip content={<SeriesTooltip rows={rows} />} cursor={{ stroke: '#64748b' }} />
            <Line dataKey="site" name={SERIES_LABELS.site} stroke={SERIES_COLORS.site} strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: SERIES_COLORS.site }} activeDot={{ r: 5 }} {...SERIES_LINE_PROPS} />
            <Line dataKey="background" name={SERIES_LABELS.background} stroke={SERIES_COLORS.background} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, strokeWidth: 0, fill: SERIES_COLORS.background }} activeDot={{ r: 5 }} {...SERIES_LINE_PROPS} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function SeriesBody({ state }: { state: SeriesState }) {
  if (state.kind === 'loading') return <div className="h-56 w-full animate-pulse rounded-lg bg-slate-700/60" aria-hidden="true" />;
  if (state.kind === 'error') {
    return <p className="rounded-lg border border-dashed border-slate-600 p-4 text-sm text-slate-400">Нет данных: {state.message}</p>;
  }
  const { data, gaveUp } = state;
  const pending = data.status === 'pending';
  const notes = missingYearNotes(data.years);
  const hasValues = data.years.some(y => y.status === 'ok');
  return (
    <>
      {pending && (
        <p className="mb-2 text-sm text-slate-400" aria-live="polite">
          {gaveUp ? 'Ряд ещё не готов — откройте событие позже.' : progressText(data.progress.done, data.progress.total)}
        </p>
      )}
      {hasValues ? <SeriesChart data={data} />
        : pending ? <div className="h-56 w-full animate-pulse rounded-lg bg-slate-700/60" aria-hidden="true" />
          : <p className="rounded-lg border border-dashed border-slate-600 p-4 text-sm text-slate-400">Нет данных: ни за один год нет безоблачного летнего снимка.</p>}
      <div className="mt-2 space-y-1 text-xs text-slate-500">
        {data.failedYears && data.failedYears.length > 0 && (
          <p>Не удалось получить {data.failedYears.join(', ')} — источник снимков недоступен, попробуйте позже.</p>
        )}
        {notes.length > 0 && <p>Без снимка: {notes.join('; ')}.</p>}
        <p>{SERIES_NOTE}</p>
        {hasValues && <p>{data.source.attribution}. Каталог: Earth Search (Element 84), AWS Open Data.</p>}
      </div>
    </>
  );
}

/** «Динамика NDVI (июль–август)»: the series is computed in the background; polls until ready (≤ 3 min). */
export default function NdviSeries({ incidentId }: { incidentId: number }) {
  const [state, setState] = useState<SeriesState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: 'loading' });
    const load = () => {
      getNdviSeries(incidentId, controller.signal)
        .then(data => {
          const again = shouldPoll(data.status, startedAt, Date.now());
          setState({ kind: 'data', data, gaveUp: data.status === 'pending' && !again });
          if (again) timer = setTimeout(load, SERIES_POLL_MS);
        })
        .catch(err => {
          if (controller.signal.aborted) return;
          setState({ kind: 'error', message: err instanceof ImageryApiError ? err.message : 'Не удалось получить ряд NDVI' });
        });
    };
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [incidentId]);

  return (
    <section className="mt-8 border-t border-slate-700 pt-6" aria-labelledby="ndvi-series-title">
      <h3 id="ndvi-series-title" className="mb-3 text-lg font-semibold">{SERIES_TITLE}</h3>
      <SeriesBody state={state} />
    </section>
  );
}
