export interface RosleskhozSummary {
  total_wood_volume_thousand_m3: number;
  total_forestland_area_thousand_ha: number;
  reforestation_latest: { year: number; area_thousand_ha: number } | null;
  fires_area_thousand_ha: number;
}

const fmt = (n: number, d = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });

/**
 * Рослесхоз national annual statistics — not a Baikal-region status, so labeled and placed below
 * the map rather than presented as "current situation" (future.md #6, §3 — every number needs its
 * source and date).
 */
function RosleshozStats({ data }: { data: RosleskhozSummary | null }) {
  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-300">Рослесхоз — официальная статистика по России (годовые данные)</span>
        <a
          href="https://rosleshoz.gov.ru/opendata/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-green-800/50 bg-green-900/30 px-2 py-0.5 text-xs text-green-400 transition-colors hover:bg-green-900/50"
        >
          rosleshoz.gov.ru/opendata
        </a>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Национальные показатели за год, не текущая ситуация в Байкальском регионе — см. счётчики выше.
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {data ? (
          <>
            <div className="card p-4 text-center">
              <p className="text-xl font-bold text-green-300">{fmt(data.total_forestland_area_thousand_ha)} тыс. га</p>
              <p className="mt-1 text-xs text-gray-400">Площадь лесных земель РФ</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xl font-bold text-blue-300">{fmt(data.total_wood_volume_thousand_m3)} тыс. м³</p>
              <p className="mt-1 text-xs text-gray-400">Заготовка древесины (год)</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xl font-bold text-emerald-300">
                {data.reforestation_latest ? `${fmt(data.reforestation_latest.area_thousand_ha, 1)} тыс. га` : '—'}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Лесовосстановление{data.reforestation_latest ? ` (${data.reforestation_latest.year})` : ''}
              </p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xl font-bold text-red-300">{fmt(data.fires_area_thousand_ha, 1)} тыс. га</p>
              <p className="mt-1 text-xs text-gray-400">Площадь пожаров (лесфонд)</p>
            </div>
          </>
        ) : (
          [...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse p-4 text-center">
              <div className="mx-auto mb-2 h-6 w-2/3 rounded bg-gray-700" />
              <div className="mx-auto h-3 w-3/4 rounded bg-gray-800" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RosleshozStats;
