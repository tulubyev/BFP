import { useEffect, useState } from 'react';
import { getIncidentImagery, ImageryApiError, type ImageryRender, type ImagerySide, type IncidentImagery as Imagery } from '../api/imagery';
import { IMAGERY_NOTE, IMAGERY_RENDER_LABELS, hasImages, imageUrl, sideCaption } from '../utils/imagery';
import { IndicesPanel, NdviLegend } from './IncidentIndices';

const RENDERS: ImageryRender[] = ['truecolor', 'swir', 'ndvi'];

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: Imagery }
  | { kind: 'error'; message: string };

function Skeleton() {
  return <div className="aspect-square w-full animate-pulse rounded-lg bg-slate-700/60" aria-hidden="true" />;
}

function SideImage({ title, side, render }: { title: string; side: ImagerySide; render: ImageryRender }) {
  const src = side.status === 'ok' ? imageUrl(side.urls[render], __CDN_URL__) : null;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-xs uppercase tracking-wide text-slate-500">{title}</figcaption>
      {side.status === 'none' ? (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-slate-600 p-4 text-center text-sm text-slate-400">
          <span>Нет данных: {side.reason}</span>
        </div>
      ) : failed === src ? (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-slate-600 p-4 text-center text-sm text-slate-400">
          <span>Снимок не загрузился</span>
        </div>
      ) : (
        <div className="relative">
          {loaded !== src && <div className="absolute inset-0"><Skeleton /></div>}
          <img
            key={src}
            src={src ?? undefined}
            alt={`${title}: ${IMAGERY_RENDER_LABELS[render]}`}
            className={`w-full rounded-lg bg-slate-900 ${loaded === src ? '' : 'aspect-square opacity-0'}`}
            onLoad={() => setLoaded(src)}
            onError={() => setFailed(src)}
          />
        </div>
      )}
      {side.status === 'ok' && (
        <ul className="mt-2 space-y-0.5 text-sm text-slate-300">
          {sideCaption(side).map(line => <li key={line} className={line.includes('активности') ? 'text-amber-300' : undefined}>{line}</li>)}
        </ul>
      )}
    </figure>
  );
}

/** «Снимки до/после»: Sentinel-2 scenes before the first hotspot and after the last one. */
export default function IncidentImagery({ incidentId }: { incidentId: number }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [render, setRender] = useState<ImageryRender>('truecolor');

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getIncidentImagery(incidentId, controller.signal)
      .then(data => setState({ kind: 'ready', data }))
      .catch(err => {
        if (controller.signal.aborted) return;
        const message = err instanceof ImageryApiError && err.status === 504
          ? 'Снимки не успели подготовиться — откройте событие ещё раз через минуту'
          : err instanceof ImageryApiError ? err.message : 'Не удалось подобрать снимки';
        setState({ kind: 'error', message });
      });
    return () => controller.abort();
  }, [incidentId]);

  return (
    <section className="mt-8 border-t border-slate-700 pt-6" aria-labelledby="imagery-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="imagery-title" className="text-lg font-semibold">Снимки до/после</h3>
        <div role="group" aria-label="Вид снимка" className="flex overflow-hidden rounded-lg border border-slate-600 text-sm">
          {RENDERS.map(r => (
            <button
              key={r}
              type="button"
              aria-pressed={render === r}
              onClick={() => setRender(r)}
              className={`px-3 py-1.5 ${render === r ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              {IMAGERY_RENDER_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {state.kind === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-2"><Skeleton /><Skeleton /></div>
      )}
      {state.kind === 'error' && (
        <p className="rounded-lg border border-dashed border-slate-600 p-4 text-sm text-slate-400">Нет данных: {state.message}</p>
      )}
      {state.kind === 'ready' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SideImage title="До" side={state.data.before} render={render} />
          <SideImage title="После" side={state.data.after} render={render} />
        </div>
      )}
      {state.kind === 'ready' && state.data.indices && <IndicesPanel indices={state.data.indices} />}

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        {state.kind === 'ready' && hasImages([state.data.before, state.data.after]) && (
          <p>{state.data.source.attribution}. Каталог: Earth Search (Element 84), AWS Open Data. Жёлтая рамка — границы события.</p>
        )}
        {render === 'swir' && <p>SWIR (B12/B8A/B04): гари — тёмно-красные, активный огонь — ярко-оранжевый, лес — зелёный.</p>}
        {render === 'ndvi' && <NdviLegend />}
        <p>{IMAGERY_NOTE}</p>
      </div>
    </section>
  );
}
