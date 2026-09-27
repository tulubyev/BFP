import type { IncidentIndices } from '../api/imagery';
import { NDVI_LEGEND, NDVI_LEGEND_NOTE, SEVERITY_STYLES, formatIndex, indexRows, ndviLegendGradient } from '../utils/imagery';

export function NdviLegend() {
  return (
    <div className="space-y-1" aria-label="Шкала NDVI">
      <div className="h-2.5 w-full max-w-xs rounded" style={{ background: ndviLegendGradient() }} aria-hidden="true" />
      <div className="flex max-w-xs justify-between"><span>{formatIndex(NDVI_LEGEND.min)}</span><span>{formatIndex(NDVI_LEGEND.max)}</span></div>
      <p>{NDVI_LEGEND_NOTE}</p>
    </div>
  );
}

/** NDVI/NBR over the site before and after, ΔNDVI, dNBR with its USGS class and the caveat. */
export function IndicesPanel({ indices }: { indices: IncidentIndices }) {
  const rows = indexRows(indices);
  return (
    <div className="mt-4 rounded-lg border border-slate-700 p-3 text-sm">
      <table className="w-full text-left">
        <caption className="mb-2 text-left text-xs uppercase tracking-wide text-slate-500">Индексы над контуром события</caption>
        <thead className="text-xs text-slate-500">
          <tr><th className="font-normal">Индекс</th><th className="font-normal">До</th><th className="font-normal">После</th><th className="font-normal">Изменение</th></tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map(row => (
            <tr key={row.label}>
              <th scope="row" className="py-0.5 font-medium">{row.label}</th>
              <td>{row.before}</td>
              <td>{row.after}</td>
              <td><span className="sr-only">{row.changeLabel} </span>{row.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {indices.severity && (
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-slate-400">dNBR {formatIndex(indices.dNbr)}:</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_STYLES[indices.severity.class]}`}>{indices.severity.label}</span>
        </p>
      )}
      {indices.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
          {indices.reasons.map(reason => <li key={reason}>Нет данных: {reason}</li>)}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Средние по чистым пикселям (маска SCL), сетка 20 м. Чистых пикселей над контуром: снимок «до» —
        {' '}{indices.before ? `${indices.before.validPct}%` : '—'}, «после» — {indices.after ? `${indices.after.validPct}%` : '—'}.
        {' '}Классы dNBR — USGS (Key &amp; Benson, 2006). Это {indices.note}.
      </p>
    </div>
  );
}
