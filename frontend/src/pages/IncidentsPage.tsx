import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getIncidents, IncidentsApiError, type Incident } from '../api/incidents';
import { formatCacheBanner, parseIncidentId } from '../utils/incidents';
import {
  PERIODS, SORTS, STATUSES, feedFilters, feedStateFromParams, hasActiveFilters, sourceLabel, updateFeedParams,
} from '../utils/incidentFeed';
import IncidentCard from '../components/IncidentCard';
import IncidentModal from '../components/IncidentModal';
import ExportButtons from '../components/ExportButtons';
import { EXPORT_LIMIT, INCIDENT_EXPORT_FORMATS, incidentsExportUrl, type IncidentsExportFormat } from '../api/export';

const PAGE_SIZE = 12;
const SELECT = 'mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white';
const LABEL = 'text-sm text-slate-400';

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);

  // Everything but `id` (the open card) defines the feed; the query string is the effect key
  const feedParams = useMemo(() => {
    const next = new URLSearchParams(params);
    next.delete('id');
    return next.toString();
  }, [params]);
  const state = useMemo(() => feedStateFromParams(new URLSearchParams(feedParams)), [feedParams]);
  const filters = useMemo(() => feedFilters(state), [state]);
  const selectedId = parseIncidentId(params.get('id'));

  const update = (key: string, value: string) => setParams(updateFeedParams(params, key, value));
  // The open card lives in the URL (`id`) only; `selected` follows it (effect below), so setting
  // it here too would race the URL update and remount the card
  const openCard = (incident: Incident) => {
    const next = new URLSearchParams(params);
    next.set('id', String(incident.id));
    setParams(next);
  };
  const closeCard = useCallback(() => {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.delete('id');
      return next;
    }, { replace: true });
  }, [setParams]);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setUnavailable(false);
    try {
      const result = await getIncidents({ ...filters, page: state.page, limit: PAGE_SIZE });
      if (!result.success) throw new Error(result.error || 'Ошибка API');
      setIncidents(result.data); setRegions(result.regions || []); setSources(result.sources || []); setTotal(result.total);
      setCachedAt(result.mode === 'cache' && result.fetched_at ? result.fetched_at : null);
    } catch (err) {
      setCachedAt(null);
      setUnavailable(err instanceof IncidentsApiError && err.status === 503);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить события');
    }
    finally { setLoading(false); }
  }, [filters, state.page]);
  useEffect(() => { load(); }, [load]);

  // A card opened by link (/incidents?id=…): from the current page, else fetched by id
  useEffect(() => {
    if (selectedId === null) { setSelected(null); return; }
    if (selected?.id === selectedId) return;
    const onPage = incidents.find(item => item.id === selectedId);
    if (onPage) { setSelected(onPage); return; }
    let cancelled = false;
    getIncidents({ id: selectedId, staticSources: 'include', limit: 1 })
      .then(result => { if (!cancelled) setSelected(result.data[0] ?? null); })
      .catch(() => { if (!cancelled) setSelected(null); });
    return () => { cancelled = true; };
  }, [selectedId, incidents, selected?.id]);

  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="px-4 py-10"><div className="mx-auto max-w-7xl">
      <div className="mb-8 max-w-3xl"><p className="mb-2 text-sm font-semibold uppercase tracking-widest text-green-400">Мониторинг в реальном времени</p><h1 className="text-3xl font-bold sm:text-4xl">Инциденты и изменения леса</h1><p className="mt-3 text-slate-400">Спутниковые наблюдения: термоточки, вырубки и повреждения леса. Тип события — предположение до проверки.</p></div>
      <div className="card mb-7 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={LABEL}>Тип события<select value={state.type} onChange={e => update('type', e.target.value)} className={SELECT}><option value="">Все типы</option><option value="fire">Пожар / термоточки</option><option value="logging">Вырубка</option><option value="disease">Повреждение</option><option value="windfall">Ветровал</option></select></label>
        <label className={LABEL}>Регион<select value={state.region} onChange={e => update('region', e.target.value)} className={SELECT}><option value="">Все регионы</option>{regions.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className={LABEL}>Источник<select value={state.source ?? ''} onChange={e => update('source', e.target.value)} className={SELECT}><option value="">Все источники</option>{[...new Set([...sources, ...(state.source ? [state.source] : [])])].map(item => <option key={item} value={item}>{sourceLabel(item)}</option>)}</select></label>
        <label className={LABEL}>Статус (FIRMS)<select value={state.status ?? ''} onChange={e => update('status', e.target.value)} className={SELECT}>{STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={LABEL}>Период<select value={state.period ?? ''} onChange={e => update('period', e.target.value)} className={SELECT}>{PERIODS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {state.period === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL}>С<input type="date" value={state.from ?? ''} max={state.to} onChange={e => update('from', e.target.value)} className={SELECT} /></label>
            <label className={LABEL}>По<input type="date" value={state.to ?? ''} min={state.from} onChange={e => update('to', e.target.value)} className={SELECT} /></label>
          </div>
        )}
        <label className={LABEL}>Сортировка<select value={state.sort} onChange={e => update('sort', e.target.value)} className={SELECT}>{SORTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className={LABEL}>Постоянные источники тепла<select value={state.staticSources ?? ''} onChange={e => update('static', e.target.value)} className={SELECT}><option value="">Скрыть (факелы, промышленность)</option><option value="include">Показать вместе с остальными</option><option value="only">Только постоянные источники</option></select></label>
      </div>
      {cachedAt && <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{formatCacheBanner(cachedAt)}</div>}
      <div className="mb-4 flex items-center justify-between"><p className="text-sm text-slate-400">Найдено событий: <span className="font-semibold text-white">{total}</span>{filters.startDate && <span> · с {filters.startDate}{filters.endDate ? ` по ${filters.endDate}` : ''} (дата обнаружения, UTC)</span>}</p>{hasActiveFilters(state) && <button onClick={() => setParams(state.sort !== 'date_desc' ? { sort: state.sort } : {})} className="text-sm text-green-400 hover:text-green-300">Сбросить фильтры</button>}</div>
      <div className="mb-6">
        <ExportButtons
          label="Скачать"
          formats={INCIDENT_EXPORT_FORMATS}
          url={format => incidentsExportUrl(format as IncidentsExportFormat, filters)}
          fileBase="forestwatch-incidents"
          hint={`по текущим фильтрам, до ${EXPORT_LIMIT} записей; с источниками и лицензиями`}
          disabledReason={!error && total > EXPORT_LIMIT ? `Под фильтры попадает ${total} записей — сузьте фильтры, выгрузка не больше ${EXPORT_LIMIT}.` : undefined}
        />
      </div>
      {error ? <div className="card text-center"><p className="text-red-300">{unavailable ? 'База данных недоступна' : 'Ошибка загрузки'}</p><p className="mt-1 text-sm text-slate-400">{error}</p><button onClick={load} className="mt-4 text-green-400">Попробовать снова</button></div> :
       loading ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-800" />)}</div> :
       incidents.length ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{incidents.map(item => <IncidentCard key={item.id} incident={item} onClick={() => openCard(item)} />)}</div> :
       <div className="card py-16 text-center text-slate-400">События с такими параметрами не найдены.</div>}
      {pages > 1 && <nav className="mt-8 flex items-center justify-center gap-4"><button disabled={state.page <= 1} onClick={() => update('page', String(state.page - 1))} className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-30">Назад</button><span className="text-sm text-slate-400">Страница {state.page} из {pages}</span><button disabled={state.page >= pages} onClick={() => update('page', String(state.page + 1))} className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-30">Далее</button></nav>}
      {selected && <IncidentModal incident={selected} onClose={closeCard} />}
    </div></div>
  );
}
