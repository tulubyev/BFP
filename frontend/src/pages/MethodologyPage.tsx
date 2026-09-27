import { useEffect, useState } from 'react';
import MethodologySections from '../methodology/MethodologySections';
import SourcesList from '../methodology/SourcesList';
import { fetchMethodologySources, type MethodologySource } from '../methodology/sources';

type SourcesState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sources: MethodologySource[] };

const CONTENTS = [
  ['sources', 'Источники данных'],
  ['firms', 'Термоточки и инциденты FIRMS'],
  ['regions', 'Региональная аналитика'],
  ['gfw', 'Потери лесного покрова'],
  ['imagery', 'Снимки Sentinel-2'],
  ['export', 'Выгрузка данных'],
] as const;

export function SourcesSection({ state }: { state: SourcesState }) {
  return (
    <section id="sources" aria-labelledby="sources-title" className="card scroll-mt-20 p-5 sm:p-6">
      <h2 id="sources-title" className="mb-2 text-xl font-bold">Источники данных</h2>
      <p className="mb-4 text-sm text-slate-400">
        Список строится из реестра источников сайта (<code className="text-xs">/api/sources/status</code>): владелец, лицензия,
        частота обновления, разрешение, ограничения и текущая свежесть.
      </p>
      {state.status === 'loading' && <p className="text-sm text-slate-400">Загрузка реестра источников…</p>}
      {state.status === 'error' && <p className="text-sm text-slate-400">Нет данных: реестр источников недоступен ({state.message}).</p>}
      {state.status === 'ready' && <SourcesList sources={state.sources} />}
    </section>
  );
}

export default function MethodologyPage() {
  const [state, setState] = useState<SourcesState>({ status: 'loading' });

  useEffect(() => {
    fetchMethodologySources()
      .then(sources => setState({ status: 'ready', sources }))
      .catch(err => setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  return (
    <div className="px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="max-w-3xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-green-400">Как считаются данные</p>
          <h1 className="text-3xl font-bold sm:text-4xl">Методология</h1>
          <p className="mt-3 text-slate-400">
            Откуда берутся данные сайта, как из термоточек получаются инциденты, как считаются региональные показатели
            и чего эти данные не означают. У каждого числа — источник, лицензия и дата.
          </p>
        </div>
        <nav aria-label="Содержание" className="card p-4 text-sm">
          <ol className="flex flex-wrap gap-x-5 gap-y-1">
            {CONTENTS.map(([id, title]) => <li key={id}><a href={`#${id}`} className="text-green-400 hover:text-green-300">{title}</a></li>)}
          </ol>
        </nav>
        <SourcesSection state={state} />
        <MethodologySections />
      </div>
    </div>
  );
}
