import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Incident } from '../api/incidents';
import { getIncidentHotspots, type IncidentHotspotsResponse } from '../api/incidentHotspots';
import { firmsIncidentInfo } from '../utils/incidents';
import { bigMapUrl, hotspotsCaption, incidentCenter, ooptLine } from '../utils/incidentHotspots';
import IncidentMiniMap from './IncidentMiniMap';

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: IncidentHotspotsResponse }
  | { status: 'error'; error: string };

/** «Место»: mini-map (bbox + the incident's FIRMS hotspots), OOPT line and a link to the big map. */
export default function IncidentLocation({ incident }: { incident: Incident }) {
  const firms = firmsIncidentInfo(incident);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!firms) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    getIncidentHotspots(incident.id, controller.signal)
      .then(data => setState({ status: 'ready', data }))
      .catch(err => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error: err instanceof Error ? err.message : 'Не удалось загрузить термоточки' });
      });
    return () => controller.abort();
  }, [incident.id, Boolean(firms)]);

  const mapUrl = bigMapUrl(incident);
  if (!firms && !incidentCenter(incident)) return null;
  const data = state.status === 'ready' ? state.data : null;
  const oopt = firms && state.status !== 'loading' ? ooptLine(data?.oopt, data?.oopt_error) : null;

  return (
    <section className="mt-8" aria-labelledby="incident-location-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="incident-location-title" className="text-lg font-semibold">Место</h3>
        {mapUrl && <Link to={mapUrl} className="text-sm text-green-400 hover:text-green-300">Открыть на большой карте →</Link>}
      </div>
      <IncidentMiniMap incident={incident} hotspots={data?.hotspots ?? []} />
      {firms && (
        <div className="mt-3 space-y-2 text-sm">
          {state.status === 'loading' && <p className="text-slate-400">Загружаем термоточки…</p>}
          {state.status === 'error' && <p className="text-amber-300">Термоточки: нет данных ({state.error})</p>}
          {data && (
            <p className="text-slate-400">
              {hotspotsCaption(data.count, data.truncated, data.limit)}. Контур + {data.buffer_m} м, {data.window.from} — {data.window.to} (UTC); {data.source}, {data.license}.
            </p>
          )}
          {oopt && (
            <div>
              <p className="text-slate-200">
                <span className="text-xs uppercase tracking-wide text-slate-500">ООПТ: </span>{oopt.text}
                {data?.oopt && data.oopt.result.relation !== 'none' && (
                  <> · <a href={data.oopt.result.osm_url} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">граница в OSM</a></>
                )}
              </p>
              <p className="text-xs text-slate-500">{oopt.note}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
