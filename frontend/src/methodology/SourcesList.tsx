import { freshnessText, type MethodologySource } from './sources';

/** Source registry as cards — generated from /api/sources/status, nothing typed by hand. */
export default function SourcesList({ sources }: { sources: MethodologySource[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {sources.map(source => (
        <li key={source.id} id={`source-${source.id}`} className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <h3 className="font-semibold text-white">{source.name}</h3>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Владелец</dt>
            <dd className="text-slate-300">{source.owner}</dd>
            <dt className="text-slate-500">Лицензия</dt>
            <dd><a href={source.license.url} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">{source.license.name}</a></dd>
            <dt className="text-slate-500">Обновление</dt>
            <dd className="text-slate-300">{source.updateFrequency}</dd>
            <dt className="text-slate-500">Разрешение</dt>
            <dd className="text-slate-300">{source.spatialResolution}</dd>
            <dt className="text-slate-500">Охват</dt>
            <dd className="text-slate-300">{source.coverage}</dd>
            <dt className="text-slate-500">Свежесть</dt>
            <dd className="text-slate-300">{freshnessText(source)}</dd>
          </dl>
          {source.limitations.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Ограничения</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-400">
                {source.limitations.map(item => <li key={item}>{item}</li>)}
              </ul>
            </>
          )}
          <a href={source.homepage} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-green-400 hover:text-green-300">Сайт источника</a>
        </li>
      ))}
    </ul>
  );
}
