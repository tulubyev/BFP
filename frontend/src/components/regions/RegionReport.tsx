import type { RegionDetailResponse } from '../../api/regions';
import {
  formatReportDateTime, hotspotTableRows, reportFooterText, reportGroups, reportLimitations, reportSources, seriesYearsLabel, type ReportRow,
} from '../../utils/regionReport';
import HotspotReportChart, { HotspotReportLegend } from './HotspotReportChart';
import ReportKindBadge from './ReportKindBadge';

function IndicatorRow({ row }: { row: ReportRow }) {
  return (
    <tr className="report-row border-t border-slate-300 align-top">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="font-semibold text-slate-900">{row.label}</span>
        <span className="mt-0.5 block text-xs text-slate-600">{row.definition}</span>
        <span className="mt-0.5 block text-[11px] text-slate-500">Источник: {row.source}</span>
      </th>
      <td className="py-2 pr-3">
        <span className={row.missing ? 'text-slate-600 italic' : 'font-semibold tabular-nums text-slate-900'}>{row.value}</span>
        <span className="mt-1 block"><ReportKindBadge kind={row.kind} /></span>
        {/* Narrow screens: the period moves under the value instead of a third column */}
        <span className="mt-1 block text-xs text-slate-700 sm:hidden print:hidden">Период: {row.period}</span>
      </td>
      <td className="hidden py-2 text-slate-700 sm:table-cell print:table-cell">{row.period}</td>
    </tr>
  );
}

/**
 * The report itself: pure render of GET /api/regions/:iso, so it is tested with react-dom/server.
 * `printedAt` is the moment the report was formed (the page passes «now»).
 */
export default function RegionReport({ detail, printedAt, timeZone }: { detail: RegionDetailResponse; printedAt: Date; timeZone?: string }) {
  const groups = reportGroups(detail);
  const sources = reportSources(detail);
  const limitations = reportLimitations(detail);
  const archiveYears = detail.archive ? seriesYearsLabel(detail.archive.years) : null;
  const seriesYears = seriesYearsLabel(detail.hotspotSeries.map(y => y.year));

  return (
    <article className="report-sheet mx-auto w-full max-w-[210mm] rounded-lg bg-white p-4 text-slate-900 shadow-xl sm:p-10 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="border-b-2 border-slate-900 pb-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">forestwatch.ru · мониторинг лесов</p>
        <h1 className="mt-1 text-2xl font-bold leading-tight">Отчёт по региону: {detail.name}</h1>
        <dl className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-slate-700 sm:grid-cols-2">
          <div><dt className="inline text-slate-500">Код субъекта: </dt><dd className="inline">{detail.iso}{detail.baikal ? ' · байкальский регион' : ''}</dd></div>
          <div><dt className="inline text-slate-500">Площадь: </dt><dd className="inline">{detail.areaKm2.toLocaleString('ru-RU')} км² (по границам OSM)</dd></div>
          <div><dt className="inline text-slate-500">Отчёт сформирован: </dt><dd className="inline">{formatReportDateTime(printedAt, timeZone)}</dd></div>
          <div><dt className="inline text-slate-500">Данные собраны: </dt><dd className="inline">{formatReportDateTime(detail.generatedAt, timeZone)}</dd></div>
        </dl>
      </header>

      <section className="mt-5" aria-labelledby="report-indicators">
        <h2 id="report-indicators" className="report-h2 text-lg font-bold">Показатели</h2>
        <p className="mt-1 text-xs text-slate-600">
          Официальные, спутниковые и оценочные показатели не смешиваются; у каждого — своё определение, единица, период и
          источник. <span className="whitespace-nowrap">Метки:</span> <ReportKindBadge kind="official" /> Рослесхоз,{' '}
          <ReportKindBadge kind="satellite" /> спутниковые наблюдения, <ReportKindBadge kind="estimate" /> приблизительная оценка (≈).
        </p>
        {groups.map(group => (
          <div key={group.kind} className="report-group mt-4">
            <h3 className="report-h3 text-sm font-bold uppercase tracking-wide text-slate-700">{group.title}</h3>
            <table className="report-table mt-1 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="py-1 pr-3 font-medium">Показатель, определение, источник</th>
                  <th scope="col" className="w-[36%] py-1 pr-3 font-medium sm:w-[28%] print:w-[28%]">Значение</th>
                  <th scope="col" className="hidden w-[18%] py-1 font-medium sm:table-cell print:table-cell">Период</th>
                </tr>
              </thead>
              <tbody>{group.rows.map(row => <IndicatorRow key={row.id} row={row} />)}</tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="report-keep mt-6" aria-labelledby="report-hotspots">
        <h2 id="report-hotspots" className="report-h2 flex flex-wrap items-center gap-2 text-lg font-bold">
          Термоточки по годам <ReportKindBadge kind="satellite" />
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          VIIRS S-NPP, годовой архив NASA FIRMS{archiveYears ? ` (${archiveYears})` : ''}, только полные годы.
          Растительность и статичные источники разделены. Термоточка — не подтверждённый пожар.
        </p>
        {detail.hotspotSeries.length === 0 ? (
          <p className="mt-2 rounded border border-slate-300 p-3 text-sm text-slate-700">Нет данных: {detail.hotspotSeriesReason ?? 'ряд пуст'}</p>
        ) : (
          <figure className="mt-2">
            <HotspotReportChart series={detail.hotspotSeries} />
            <figcaption className="mt-1"><HotspotReportLegend /></figcaption>
            <table className="report-table mt-3 w-full border-collapse text-sm tabular-nums">
              <caption className="pb-1 text-left text-xs text-slate-500">Ряд {seriesYears}, шт.</caption>
              <thead>
                <tr className="text-right text-xs text-slate-500">
                  <th scope="col" className="py-1 pr-3 text-left font-medium">Год</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Растительность</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Статичные источники</th>
                  <th scope="col" className="py-1 font-medium">Растительность на 10 тыс. км²</th>
                </tr>
              </thead>
              <tbody>
                {hotspotTableRows(detail.hotspotSeries).map(r => (
                  <tr key={r.year} className="report-row border-t border-slate-300 text-right">
                    <th scope="row" className="py-1 pr-3 text-left font-normal">{r.year}</th>
                    <td className="py-1 pr-3">{r.vegetation}</td>
                    <td className="py-1 pr-3">{r.static}</td>
                    <td className="py-1">{r.per10k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}
      </section>

      <section className="report-keep mt-6" aria-labelledby="report-limits">
        <h2 id="report-limits" className="report-h2 text-lg font-bold">Ограничения и методология</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
          {limitations.map(item => <li key={item}>{item}</li>)}
        </ul>
        <p className="mt-2 text-sm text-slate-800">
          Подробная методика: <a href="/methodology" className="report-link text-sky-800 underline">forestwatch.ru/methodology</a>
        </p>
      </section>

      <section className="report-keep mt-6" aria-labelledby="report-sources">
        <h2 id="report-sources" className="report-h2 text-lg font-bold">Источники и лицензии</h2>
        <ul className="mt-1 space-y-1.5 text-sm text-slate-800">
          {sources.map(s => (
            <li key={s.id} className="report-row">
              <span className="font-semibold">{s.name}</span> — {s.usedFor}. Лицензия: {s.license}.{' '}
              <span className="text-slate-600">Атрибуция: {s.attribution}.</span>{' '}
              <a href={s.url} className="report-link break-words text-sky-800 [overflow-wrap:anywhere] underline">{s.url}</a>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-8 border-t border-slate-400 pt-2 text-[11px] leading-snug text-slate-600">
        <p>{reportFooterText(detail, printedAt, timeZone)}</p>
        <p>Периоды указаны у каждого показателя. «Нет данных» — не ноль. Потеря покрова ≠ незаконная рубка.</p>
      </footer>
    </article>
  );
}
