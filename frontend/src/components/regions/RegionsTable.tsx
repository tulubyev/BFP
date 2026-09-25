import { useMemo, useState } from 'react';
import type { RegionSummary } from '../../api/regions';
import {
  REGION_COLUMNS, columnKind, findIndicator, formatIndicatorNumber, nextSort, sortRegionRows, type SortState,
} from '../../utils/regions';
import KindBadge from './KindBadge';

function SortMark({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return <span className={active ? 'text-green-400' : 'text-slate-600'} aria-hidden="true">{active && dir === 'asc' ? '▲' : '▼'}</span>;
}

/**
 * Sortable table of the 83 regions. It scrolls horizontally inside its own block, so at 375 px the
 * page itself never scrolls sideways. All API strings are rendered as React text nodes.
 */
export default function RegionsTable({ regions, onSelect }: { regions: RegionSummary[]; onSelect: (iso: string) => void }) {
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const rows = useMemo(() => sortRegionRows(regions, sort), [regions, sort]);
  const ariaSort = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

  return (
    <div className="w-full max-w-full overflow-x-auto rounded-lg border border-slate-700/60" role="region" aria-label="Таблица субъектов" tabIndex={0}>
      <table className="min-w-[1100px] w-full text-sm">
        <thead className="bg-slate-900/80 text-left text-xs text-gray-400">
          <tr>
            <th scope="col" aria-sort={ariaSort('name')} className="sticky left-0 z-10 bg-slate-900 px-3 py-2 align-bottom">
              <button type="button" onClick={() => setSort(s => nextSort(s, 'name'))} className="flex items-center gap-1 font-semibold hover:text-white">
                Субъект <SortMark active={sort.key === 'name'} dir={sort.dir} />
              </button>
            </th>
            {REGION_COLUMNS.map(col => {
              const kind = columnKind(regions, col.id);
              return (
                <th key={col.id} scope="col" aria-sort={ariaSort(col.id)} className="px-3 py-2 align-bottom">
                  <button type="button" onClick={() => setSort(s => nextSort(s, col.id))} className="flex flex-col items-start gap-1 text-left font-semibold hover:text-white">
                    <span className="flex items-center gap-1">{col.header} <SortMark active={sort.key === col.id} dir={sort.dir} /></span>
                    {kind && <KindBadge kind={kind} />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(region => (
            <tr
              key={region.iso}
              onClick={() => onSelect(region.iso)}
              className={`cursor-pointer border-t border-slate-800 hover:bg-slate-700/40 ${region.baikal ? 'bg-emerald-950/40' : ''}`}
            >
              <th scope="row" className={`sticky left-0 z-10 px-3 py-2 text-left font-medium ${region.baikal ? 'bg-emerald-950' : 'bg-slate-900'}`}>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onSelect(region.iso); }}
                  className="text-left text-white hover:text-green-400 focus:outline-none focus-visible:underline"
                >
                  {region.name}
                </button>
                {region.baikal && <span className="ml-1 text-[10px] uppercase text-emerald-400">Байкал</span>}
              </th>
              {REGION_COLUMNS.map(col => {
                const indicator = findIndicator(region, col.id);
                const missing = !indicator || indicator.value == null;
                return (
                  <td key={col.id} className="px-3 py-2 align-top" title={missing ? indicator?.reason ?? undefined : undefined}>
                    <span className={missing ? 'text-gray-500' : 'text-white tabular-nums'}>{formatIndicatorNumber(indicator)}</span>
                    {indicator?.period && <span className="block text-[11px] leading-tight text-gray-500">{indicator.period}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
