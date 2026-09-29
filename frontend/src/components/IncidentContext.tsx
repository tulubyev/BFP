import { useEffect, useState } from 'react';
import { getIncidentContext, type IncidentContextResponse } from '../api/incidentContext';
import { contextNote, contextRows } from '../utils/incidentContext';

export type ContextState =
  | { status: 'loading' }
  | { status: 'ready'; data: IncidentContextResponse }
  | { status: 'error'; error: string };

/** The rows for a state: loading line, «нет данных (…)», or road / settlement rows with the OSM note. */
export function ContextBody({ state }: { state: ContextState }) {
  if (state.status === 'loading') return <p className="text-slate-400">Ищем ближайшие дороги и населённые пункты…</p>;
  if (state.status === 'error') return <p className="text-amber-300">Дороги и населённые пункты: нет данных ({state.error})</p>;
  const { data } = state;
  return (
    <div>
      {contextRows(data).map(row => (
        <p key={row.label} className="text-slate-200">
          <span className="text-xs uppercase tracking-wide text-slate-500">{row.label}: </span>{row.text}
          {row.href && (
            <> · <a href={row.href} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">в OSM</a></>
          )}
          {row.hint && <span className="text-xs text-slate-500"> ({row.hint})</span>}
        </p>
      ))}
      <p className="text-xs text-slate-500">{contextNote(data)}</p>
    </div>
  );
}

/** «Место»: nearest road, paved road, track and settlement of a FIRMS incident (from OSM). */
export default function IncidentContext({ incidentId }: { incidentId: number }) {
  const [state, setState] = useState<ContextState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    getIncidentContext(incidentId, controller.signal)
      .then(data => setState({ status: 'ready', data }))
      .catch(err => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error: err instanceof Error ? err.message : 'Не удалось загрузить дороги и населённые пункты' });
      });
    return () => controller.abort();
  }, [incidentId]);

  return <ContextBody state={state} />;
}
