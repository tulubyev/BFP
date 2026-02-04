function AnalyticsPage() {
  return (
    <div className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold mb-12 text-center">Аналитика лесного покрова</h2>
        
        <div className="flex flex-row flex-wrap lg:flex-nowrap gap-8 justify-between">
          <div className="card p-8 hover:border-green-500/50 transition flex-1 min-w-[300px]">
            <div className="w-12 h-12 bg-green-500/20 text-green-400 rounded-lg flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h4 className="text-xl font-bold mb-3 text-green-400">Состояние лесов</h4>
            <p className="text-gray-400 text-sm mb-6">Анализ здоровья лесных массивов на основе вегетационных индексов (NDVI). Отслеживание сезонных изменений.</p>
            <button className="btn-secondary w-full text-xs">Открыть детальный отчет</button>
          </div>

          <div className="card p-8 hover:border-red-500/50 transition flex-1 min-w-[300px]">
            <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.985-7C14 5 14.985 8 15 10c2 0 3-1 3-1 0 1-1 5-1 5s.007 3.332-1.343 4.657z"/>
              </svg>
            </div>
            <h4 className="text-xl font-bold mb-3 text-red-400">Пожарная активность</h4>
            <p className="text-gray-400 text-sm mb-6">Мониторинг термоточек в реальном времени, анализ площадей гарей и оценка ущерба.</p>
            <button className="btn-secondary w-full text-xs">Карта пожаров</button>
          </div>

          <div className="card p-8 hover:border-orange-500/50 transition flex-1 min-w-[300px]">
            <div className="w-12 h-12 bg-orange-500/20 text-orange-400 rounded-lg flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            </div>
            <h4 className="text-xl font-bold mb-3 text-orange-400">Вырубки</h4>
            <p className="text-gray-400 text-sm mb-6">Детекция изменений лесного покрова, выявление незаконных действий и сопоставление с ФГИС ЛК.</p>
            <button className="btn-secondary w-full text-xs">Статистика вырубок</button>
          </div>
        </div>

        <div className="mt-20 card p-12 text-center bg-slate-800/50">
          <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
          </div>
          <h3 className="text-2xl font-bold mb-4">Расширенная аналитика</h3>
          <p className="text-gray-400 mb-8 max-w-2xl mx-auto">Детальные отчеты по спектральным индексам, временные ряды изменений и прогнозная аналитика на основе машинного обучения.</p>
          <button className="btn-primary">В разработке</button>
        </div>
      </div>
    </div>
  );
}

export default AnalyticsPage;
