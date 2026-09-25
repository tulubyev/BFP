import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getIncidents, IncidentsApiError, type Incident } from '../api/incidents';
import { formatCacheBanner, parsePage, parseStaticSources } from '../utils/incidents';
import IncidentCard from '../components/IncidentCard';
import IncidentModal from '../components/IncidentModal';

const PAGE_SIZE = 12;

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const type = params.get('type') || '';
  const region = params.get('region') || '';
  const sort = (params.get('sort') || 'date_desc') as 'date_desc' | 'date_asc' | 'area_desc' | 'area_asc';
  const page = parsePage(params.get('page'));
  const staticSources = parseStaticSources(params.get('static'));

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };
  const load = useCallback(async () => {
    setLoading(true); setError(''); setUnavailable(false);
    try {
      const result = await getIncidents({ type, region, sort, staticSources, page, limit: PAGE_SIZE });
      if (!result.success) throw new Error(result.error || 'Ошибка API');
      setIncidents(result.data); setRegions(result.regions || []); setTotal(result.total);
      setCachedAt(result.mode === 'cache' && result.fetched_at ? result.fetched_at : null);
      const requestedId = Number(params.get('id'));
      if (requestedId) setSelected(result.data.find(item => item.id === requestedId) || null);
    } catch (err) {
      setCachedAt(null);
      setUnavailable(err instanceof IncidentsApiError && err.status === 503);
      setError(err instanceof Error ? err.message : 'Не удалось загрузить события');
    }
    finally { setLoading(false); }
  }, [type, region, sort, staticSources, page, params]);
  useEffect(() => { load(); }, [load]);
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="px-4 py-10"><div className="mx-auto max-w-7xl">
      <div className="mb-8 max-w-3xl"><p className="mb-2 text-sm font-semibold uppercase tracking-widest text-green-400">Мониторинг в реальном времени</p><h1 className="text-3xl font-bold sm:text-4xl">Инциденты и изменения леса</h1><p className="mt-3 text-slate-400">Подтверждаемые спутниковые наблюдения: пожары, вырубки и повреждения леса.</p></div>
      <div className="card mb-7 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-slate-400">Тип события<select value={type} onChange={e => update('type', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white"><option value="">Все типы</option><option value="fire">Пожар</option><option value="logging">Вырубка</option><option value="disease">Повреждение</option><option value="windfall">Ветровал</option></select></label>
        <label className="text-sm text-slate-400">Регион<select value={region} onChange={e => update('region', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white"><option value="">Все регионы</option>{regions.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm text-slate-400">Сортировка<select value={sort} onChange={e => update('sort', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white"><option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option><option value="area_desc">По площади: больше</option><option value="area_asc">По площади: меньше</option></select></label>
        <label className="text-sm text-slate-400">Постоянные источники тепла<select value={staticSources ?? ''} onChange={e => update('static', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-white"><option value="">Скрыть (факелы, промышленность)</option><option value="include">Показать вместе с остальными</option><option value="only">Только постоянные источники</option></select></label>
      </div>
      {cachedAt && <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{formatCacheBanner(cachedAt)}</div>}
      <div className="mb-4 flex items-center justify-between"><p className="text-sm text-slate-400">Найдено событий: <span className="font-semibold text-white">{total}</span></p>{(type || region || staticSources) && <button onClick={() => setParams({})} className="text-sm text-green-400 hover:text-green-300">Сбросить фильтры</button>}</div>
      {error ? <div className="card text-center"><p className="text-red-300">{unavailable ? 'База данных недоступна' : 'Ошибка загрузки'}</p><p className="mt-1 text-sm text-slate-400">{error}</p><button onClick={load} className="mt-4 text-green-400">Попробовать снова</button></div> :
       loading ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-800" />)}</div> :
       incidents.length ? <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{incidents.map(item => <IncidentCard key={item.id} incident={item} onClick={() => setSelected(item)} />)}</div> :
       <div className="card py-16 text-center text-slate-400">События с такими параметрами не найдены.</div>}
      {pages > 1 && <nav className="mt-8 flex items-center justify-center gap-4"><button disabled={page <= 1} onClick={() => update('page', String(page - 1))} className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-30">Назад</button><span className="text-sm text-slate-400">Страница {page} из {pages}</span><button disabled={page >= pages} onClick={() => update('page', String(page + 1))} className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-30">Далее</button></nav>}
      {selected && <IncidentModal incident={selected} onClose={() => setSelected(null)} />}
    </div></div>
  );
}