import { useCallback, useEffect, useState } from 'react';
import { fetchRegionsList, type RegionsListResponse } from '../../api/regions';
import { REGION_EXPORT_FORMATS, regionsExportUrl, type RegionsExportFormat } from '../../api/export';
import ExportButtons from '../ExportButtons';
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

  // «К таблице регионов» from the report links to /analytics#regions; the router does not scroll to hashes
  const ready = state.status === 'ready';
  useEffect(() => {
    if (ready && window.location.hash === '#regions') document.getElementById('regions')?.scrollIntoView();
  }, [ready]);

  return (
    <section id="regions" className="card min-w-0 scroll-mt-20 p-4 sm:p-6" aria-labelledby="regions-title">
      <div className="mb-4 space-y-2">
        <h3 id="regions-title" className="text-xl font-bold">Регионы</h3>
        <p className="text-sm text-gray-400">
          83 субъекта РФ, байкальские — сверху. Официальные, спутниковые и оценочные показатели разделены и помечены;
          под каждым числом — его период. Нажмите на субъект, чтобы открыть карточку с рядом по годам, определениями и источниками;
          «Отчёт для печати» — та же сводка на листе A4 (можно сохранить в PDF).
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
          <div className="mt-3">
            <ExportButtons
              label="Скачать таблицу"
              formats={REGION_EXPORT_FORMATS}
              url={format => regionsExportUrl(format as RegionsExportFormat)}
              fileBase="forestwatch-regions"
              hint="строка на субъект и показатель; пустая ячейка — нет данных, не ноль"
            />
          </div>
        </>
      )}

      {selected && <RegionCard iso={selected} onClose={close} />}
    </section>
  );
}
