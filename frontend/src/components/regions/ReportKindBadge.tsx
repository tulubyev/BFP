import type { IndicatorKind } from '../../api/regions';
import { KIND_LABELS } from '../../utils/regions';

/**
 * Light badge for the printed report. Kinds differ by word and border style (solid / dashed /
 * dotted), so they stay distinguishable on a black-and-white printout.
 */
const KIND_STYLES: Record<IndicatorKind, string> = {
  official: 'border-solid border-green-700 text-green-900 bg-green-50',
  satellite: 'border-dashed border-sky-700 text-sky-900 bg-sky-50',
  estimate: 'border-dotted border-amber-700 text-amber-900 bg-amber-50',
};

export default function ReportKindBadge({ kind }: { kind: IndicatorKind }) {
  return (
    <span className={`report-badge inline-block whitespace-nowrap rounded border-2 px-1.5 text-[11px] leading-5 ${KIND_STYLES[kind]}`}>
      {KIND_LABELS[kind]}
    </span>
  );
}
