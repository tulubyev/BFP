import { useCallback, useEffect, useState } from 'react';
import { fetchRegionsList, type RegionsListResponse } from '../../api/regions';
import KindBadge from './KindBadge';
import RegionCard from './RegionCard';
import RegionsTable from './RegionsTable';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: RegionsListResponse };

/** «Регионы» section of the analytics page: table of the 83 regions + region card. */
export default function RegionsSection() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const close = useCallback(() => setSelected(null), []);

  useEffect(() => {
    fetchRegionsList()
      .then(data => setState({ status: 'ready', data }))
      .catch(err => setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  return (
    <section className="card min-w-0 p-4 sm:p-6" aria-labelledby="regions-title">
      <div className="mb-4 space-y-2">
        <h3 id="regions-title" className="text-xl font-bold">Регионы</h3>
        <p className="text-sm text-gray-400">
          83 субъекта РФ, байкальские — сверху. Официальные, спутниковые и оценочные показатели разделены и помечены;
          под каждым числом — его период. Нажмите на субъект, чтобы открыть карточку с рядом по годам, определениями и источниками.
        </p>
        <div className="flex flex-wrap gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><KindBadge kind="official" /> Рослесхоз</span>
          <span className="flex items-center gap-1"><KindBadge kind="satellite" /> NASA FIRMS</span>
          <span className="flex items-center gap-1"><KindBadge kind="estimate" /> приблизительно (ООПТ, потери покрова)</span>
        </div>
      </div>

      {state.status === 'loading' && <p className="py-8 text-center text-gray-400">Загрузка региональных данных…</p>}
      {state.status === 'error' && <p className="py-8 text-center text-gray-400">Нет данных: региональная сводка недоступна ({state.message})</p>}
      {state.status === 'ready' && (
        <>
          {!state.data.archive && (
            <p className="mb-3 rounded-lg border border-yellow-800/60 bg-yellow-950/30 p-3 text-xs text-yellow-300">
              Архив термоточек FIRMS ещё не собран — годовые показатели по термоточкам пока «нет данных».
            </p>
          )}
          <RegionsTable regions={state.data.regions} onSelect={setSelected} />
          <p className="mt-3 text-xs text-gray-500">
            Сводка собрана {new Date(state.data.generatedAt).toLocaleString('ru-RU')}. Термоточки текущего сезона (NRT) —
            история сайта с 25.09.2026, с годовым архивом не сравнимы. Площадь субъектов — по границам OSM
            ({state.data.boundariesFile}); Крым, Севастополь и регионы 2022 г. не включены.
          </p>
        </>
      )}

      {selected && <RegionCard iso={selected} onClose={close} />}
    </section>
  );
}
