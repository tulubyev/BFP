import { formatFreshnessLabel, STATE_COLOR, type SourceStatusEntry } from '../map/sourcesStatus';
import { formatStatNumber, type Stat } from '../utils/homeStats';

interface StatPillProps {
  value: string;
  label: string;
  sourceLabel: string;
}

function StatPill({ value, label, sourceLabel }: StatPillProps) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-3">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-[11px] text-slate-600">{sourceLabel}</p>
    </div>
  );
}

interface HomeHeroProps {
  activeFires: Stat<number>;
  hotspots24h: Stat<number>;
  firmsSource: SourceStatusEntry | null;
}

/** Compact header: what the service is, plus current Baikal situation at a glance. */
function HomeHero({ activeFires, hotspots24h, firmsSource }: HomeHeroProps) {
  return (
    <div className="mb-6">
      <p className="text-sm font-semibold uppercase tracking-widest text-green-400">Байкальский регион</p>
      <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Спутниковый мониторинг лесов</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Карта пожаров и изменений лесного покрова Иркутской области, Бурятии и Забайкальского края
        по данным NASA FIRMS, Global Forest Watch и OpenStreetMap.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatPill
          value={formatStatNumber(activeFires)}
          label="Активных очагов (кластеры FIRMS)"
          sourceLabel="NASA FIRMS VIIRS, кластеризация термоточек"
        />
        <StatPill
          value={formatStatNumber(hotspots24h)}
          label="Термоточек за 24 ч"
          sourceLabel="NASA FIRMS VIIRS NRT"
        />
        <div className="col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-3 sm:col-span-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: firmsSource ? STATE_COLOR[firmsSource.state] : STATE_COLOR.unknown }}
            />
            <p className="text-sm font-semibold text-white">Свежесть данных FIRMS</p>
          </div>
          <p className="mt-1 text-xs text-slate-400">{firmsSource ? formatFreshnessLabel(firmsSource) : 'нет данных'}</p>
        </div>
      </div>
    </div>
  );
}

export default HomeHero;
