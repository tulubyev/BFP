import { useId } from 'react';
import type { HotspotYear } from '../../api/regions';
import { hotspotChartGeometry, hotspotChartSummary } from '../../utils/regionReport';

/**
 * Per-year hotspot bars for the printed report. Plain SVG in a fixed viewBox (scales to the A4
 * column, renders on the server); vegetation is solid, static sources are hatched and every bar
 * carries its value, so the chart reads in black and white.
 */
export default function HotspotReportChart({ series }: { series: HotspotYear[] }) {
  const g = hotspotChartGeometry(series);
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={hotspotChartSummary(series)} className="report-chart block h-auto w-full" fontSize={11}>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={6} height={6} fill="#fff" />
          <line x1={0} y1={0} x2={0} y2={6} stroke="#1f2937" strokeWidth={2} />
        </pattern>
      </defs>
      {g.ticks.map(t => (
        <g key={t.value}>
          <line x1={g.plot.left} x2={g.plot.right} y1={t.y} y2={t.y} stroke="#cbd5e1" strokeDasharray={t.value === 0 ? undefined : '3 3'} />
          <text x={g.plot.left - 6} y={t.y} textAnchor="end" dominantBaseline="middle" fill="#334155">{t.label}</text>
        </g>
      ))}
      <line x1={g.plot.left} x2={g.plot.right} y1={g.plot.bottom} y2={g.plot.bottom} stroke="#0f172a" />
      {g.bars.map(b => (
        <g key={`${b.year}-${b.series}`}>
          <rect
            x={b.x} y={b.y} width={b.width} height={Math.max(b.height, 0)}
            fill={b.series === 'vegetation' ? '#374151' : `url(#${hatch})`} stroke="#0f172a" strokeWidth={1}
          />
          <text x={b.x + b.width / 2} y={b.y - 4} textAnchor="middle" fill="#0f172a" fontSize={10}>{b.label}</text>
        </g>
      ))}
      {g.years.map(y => (
        <text key={y.year} x={y.x} y={g.plot.bottom + 18} textAnchor="middle" fill="#0f172a">{y.year}</text>
      ))}
    </svg>
  );
}

/** Legend swatches match the bars: solid = vegetation, hatched = static sources. */
export function HotspotReportLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
      <span className="flex items-center gap-1.5">
        <svg width="18" height="12" aria-hidden="true"><rect x="0.5" y="0.5" width="17" height="11" fill="#374151" stroke="#0f172a" /></svg>
        Растительность (сплошная заливка)
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="12" aria-hidden="true">
          <defs>
            <pattern id="legend-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fff" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#1f2937" strokeWidth="2" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width="17" height="11" fill="url(#legend-hatch)" stroke="#0f172a" />
        </svg>
        Статичные источники — факелы, промышленность (штриховка)
      </span>
    </div>
  );
}
