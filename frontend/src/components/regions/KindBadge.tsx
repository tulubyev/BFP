import type { IndicatorKind } from '../../api/regions';
import { KIND_LABELS } from '../../utils/regions';

const KIND_STYLES: Record<IndicatorKind, { box: string; dot: string; title: string }> = {
  official: { box: 'bg-green-900/50 text-green-400 border-green-700', dot: 'bg-green-400', title: 'Официальная статистика (Рослесхоз)' },
  satellite: { box: 'bg-sky-900/50 text-sky-300 border-sky-700', dot: 'bg-sky-300', title: 'Спутниковые наблюдения' },
  estimate: { box: 'bg-yellow-900/40 text-yellow-400 border-yellow-700', dot: 'bg-yellow-400', title: 'Оценка — приблизительное значение' },
};

export default function KindBadge({ kind }: { kind: IndicatorKind }) {
  const style = KIND_STYLES[kind];
  return (
    <span title={style.title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-normal ${style.box}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {KIND_LABELS[kind]}
    </span>
  );
}
