import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Area, AreaChart, Cell
} from 'recharts';
import {
  fetchDeforestationByRegion,
  fetchRegions,
  fetchFireStats,
  fetchForestChanges,
  type TreeCoverLossYear,
  type RegionInfo,
  type FireStat
} from '../api/analytics';

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const CHANGE_TYPE_LABELS: Record<string, string> = {
  fire: 'Пожар',
  logging: 'Вырубка',
  disease: 'Болезнь',
  windfall: 'Ветровал',
  flood: 'Подтопление',
  regrowth: 'Восстановление',
  planting: 'Посадки',
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  fire: '#ef4444',
  logging: '#f97316',
  disease: '#a855f7',
  windfall: '#64748b',
  flood: '#3b82f6',
  regrowth: '#22c55e',
  planting: '#84cc16',
};

function formatHa(ha: number): string {
  if (ha >= 1_000_000) return `${(ha / 1_000_000).toFixed(2)} млн га`;
  if (ha >= 1_000) return `${(ha / 1_000).toFixed(1)} тыс. га`;
  return `${ha} га`;
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`card p-6 border-l-4`} style={{ borderLeftColor: color }}>
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

const CustomTooltipLoss = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm">
      <p className="font-bold text-white mb-1">{label} год</p>
      <p className="text-red-400">Потери: {formatHa(payload[0]?.value)}</p>
      {payload[1] && <p className="text-orange-400">CO₂: {(payload[1]?.value / 1000).toFixed(0)} тыс. т</p>}
    </div>
  );
};

const CustomTooltipFire = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm">
      <p className="font-bold text-white mb-1">{label}</p>
      <p className="text-orange-400">Термоточек: {payload[0]?.value}</p>
    </div>
  );
};

function AnalyticsPage() {
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [lossData, setLossData] = useState<TreeCoverLossYear[]>([]);
  const [fireStats, setFireStats] = useState<FireStat[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lossLoading, setLossLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchRegions(), fetchFireStats(), fetchForestChanges()])
      .then(([r, f, c]) => {
        setRegions(r);
        setFireStats(f);
        setChanges(c);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadLoss = useCallback((region: string) => {
    setLossLoading(true);
    fetchDeforestationByRegion(region, 2001, 2023)
      .then(setLossData)
      .catch(e => setError(e.message))
      .finally(() => setLossLoading(false));
  }, []);

  useEffect(() => { loadLoss('all'); }, [loadLoss]);

  const handleRegionChange = (code: string) => {
    setSelectedRegion(code);
    loadLoss(code);
  };

  const totalLoss = lossData.reduce((s, d) => s + d.area_ha, 0);
  const peakYear = lossData.reduce((a, b) => (b.area_ha > a.area_ha ? b : a), lossData[0] || { year: 0, area_ha: 0 });
  const avgLoss = lossData.length ? Math.round(totalLoss / lossData.length) : 0;
  const totalCO2 = lossData.reduce((s, d) => s + d.emissions_Mg_CO2, 0);

  const selectedRegionInfo = regions.find(r => r.code === selectedRegion);

  const monthlyFireData = MONTH_NAMES.map((name, i) => {
    const month = i + 1;
    const total = fireStats.filter(f => f.month === month).reduce((s, f) => s + Number(f.count), 0);
    return { name, count: total };
  });

  const changesByType = changes.reduce((acc: Record<string, number>, c) => {
    acc[c.change_type] = (acc[c.change_type] || 0) + 1;
    return acc;
  }, {});
  const changesChartData = Object.entries(changesByType).map(([type, count]) => ({
    name: CHANGE_TYPE_LABELS[type] || type,
    count,
    color: CHANGE_TYPE_COLORS[type] || '#6b7280',
  }));

  if (loading) {
    return (
      <div className="py-24 text-center text-gray-400">
        <div className="w-10 h-10 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        Загрузка данных...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-24 text-center">
        <p className="text-red-400 mb-2">Ошибка загрузки данных</p>
        <p className="text-gray-500 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="py-10 px-4">
      <div className="max-w-7xl mx-auto space-y-10">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold">Аналитика лесного покрова</h2>
            <p className="text-gray-400 text-sm mt-1">
              Данные: Global Forest Watch / Hansen UMD · Спутники Landsat · 2001–2023
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-gray-400 text-sm whitespace-nowrap">Регион:</label>
            <select
              value={selectedRegion}
              onChange={e => handleRegionChange(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400"
            >
              {regions.map(r => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Суммарные потери (2001–2023)"
            value={formatHa(totalLoss)}
            sub={selectedRegionInfo ? `из ${formatHa(selectedRegionInfo.forestArea_ha)} лесного фонда` : undefined}
            color="#ef4444"
          />
          <KpiCard
            label="Пик потерь"
            value={peakYear.year ? `${peakYear.year} год` : '—'}
            sub={peakYear.area_ha ? formatHa(peakYear.area_ha) : undefined}
            color="#f97316"
          />
          <KpiCard
            label="Средний темп потерь"
            value={formatHa(avgLoss)}
            sub="в год"
            color="#eab308"
          />
          <KpiCard
            label="Выбросы CO₂"
            value={`${(totalCO2 / 1_000_000).toFixed(1)} млн т`}
            sub="за весь период"
            color="#8b5cf6"
          />
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold">Потери лесного покрова по годам</h3>
              <p className="text-gray-500 text-sm mt-1">
                {selectedRegionInfo?.name} · данные Hansen/UMD/Google
              </p>
            </div>
            {lossLoading && (
              <div className="w-5 h-5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={lossData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}т` : String(v)}
                width={55}
              />
              <Tooltip content={<CustomTooltipLoss />} />
              <Area
                type="monotone"
                dataKey="area_ha"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#lossGrad)"
                name="Потери (га)"
                dot={false}
                activeDot={{ r: 4, fill: '#ef4444' }}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
              Годовые потери лесного покрова (га)
            </span>
            <span>Источник: Global Forest Watch, Hansen/UMD/Google/USGS/NASA</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="card p-6">
            <h3 className="text-xl font-bold mb-1">Пожарная активность</h3>
            <p className="text-gray-500 text-sm mb-6">Термоточки из БД по месяцам (NASA FIRMS)</p>
            {monthlyFireData.every(d => d.count === 0) ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.985-7C14 5 14.985 8 15 10c2 0 3-1 3-1 0 1-1 5-1 5s.007 3.332-1.343 4.657z" />
                </svg>
                <p className="text-sm">Исторических термоточек в БД нет</p>
                <p className="text-xs mt-1 text-gray-600">Живые данные доступны на карте через NASA FIRMS</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyFireData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltipFire />} />
                  <Bar dataKey="count" fill="#f97316" radius={[3, 3, 0, 0]} name="Термоточек" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-xl font-bold mb-1">Изменения лесного покрова</h3>
            <p className="text-gray-500 text-sm mb-6">По типам из базы данных мониторинга</p>
            {changesChartData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                Нет данных об изменениях
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={changesChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                    labelStyle={{ color: '#fff' }}
                    itemStyle={{ color: '#94a3b8' }}
                  />
                  <Bar dataKey="count" name="Случаев" radius={[3, 3, 0, 0]}>
                    {changesChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="text-xl font-bold mb-1">Выбросы CO₂ от потерь лесов</h3>
          <p className="text-gray-500 text-sm mb-6">
            {selectedRegionInfo?.name} · оценка по методологии IPCC / GFW Carbon
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={lossData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={v => `${(v / 1_000_000).toFixed(1)}М`}
                width={50}
              />
              <Tooltip
                formatter={(v: number) => [`${(v / 1_000_000).toFixed(2)} млн т CO₂`, 'Выбросы']}
                contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
                labelStyle={{ color: '#fff' }}
                labelFormatter={l => `${l} год`}
              />
              <Line
                type="monotone"
                dataKey="emissions_Mg_CO2"
                stroke="#a855f7"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                name="CO₂ (т)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-6 bg-slate-800/40">
          <h3 className="text-lg font-bold mb-4">Источники данных</h3>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div className="space-y-1">
              <p className="font-semibold text-green-400">Global Forest Watch</p>
              <p className="text-gray-400">Hansen/UMD/Google/USGS/NASA</p>
              <p className="text-gray-500 text-xs">Потери лесного покрова, 30м Landsat, 2001–2023</p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-orange-400">NASA FIRMS</p>
              <p className="text-gray-400">VIIRS / MODIS</p>
              <p className="text-gray-500 text-xs">Термоточки, обновление каждые 3 ч</p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-blue-400">Мониторинговая БД</p>
              <p className="text-gray-400">PostgreSQL / forest_db</p>
              <p className="text-gray-500 text-xs">Изменения, зоны, заповедники Байкала</p>
            </div>
          </div>
          <p className="text-gray-600 text-xs mt-4">
            * Данные по регионам сгенерированы на основе реалистичных базовых показателей.
            Для получения точных данных подключите API-ключ Global Forest Watch.
          </p>
        </div>

      </div>
    </div>
  );
}

export default AnalyticsPage;
