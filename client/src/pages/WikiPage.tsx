import { useState, type ReactNode } from 'react';

interface ModalContent {
  title: string;
  content: ReactNode;
}

const modalContents: Record<string, ModalContent> = {
  'save-forests': {
    title: 'Сохранение лесов мира',
    content: (
      <div className="space-y-4">
        <p>Леса покрывают около 31% суши планеты и являются домом для 80% наземного биоразнообразия. Они играют критическую роль в регулировании климата, поглощая CO2 и производя кислород.</p>
        <h4 className="text-lg font-bold text-green-400">Основные угрозы:</h4>
        <ul className="list-disc list-inside space-y-2 text-gray-300">
          <li>Незаконная вырубка и промышленная заготовка древесины</li>
          <li>Расширение сельскохозяйственных угодий</li>
          <li>Лесные пожары, усиленные изменением климата</li>
          <li>Добыча полезных ископаемых и урбанизация</li>
        </ul>
        <h4 className="text-lg font-bold text-green-400 mt-6">Методы защиты:</h4>
        <ul className="list-disc list-inside space-y-2 text-gray-300">
          <li>Спутниковый мониторинг в реальном времени</li>
          <li>Создание охраняемых природных территорий</li>
          <li>Устойчивое лесопользование по стандартам FSC</li>
          <li>Восстановление деградированных лесных территорий</li>
        </ul>
      </div>
    )
  },
  'funds': {
    title: 'Специализированные фонды',
    content: (
      <div className="space-y-4">
        <p>Организации, занимающиеся защитой и восстановлением лесов по всему миру:</p>
        <div className="space-y-4 mt-6">
          <div className="p-4 bg-slate-700/50 rounded-lg">
            <h4 className="font-bold text-green-400">World Wildlife Fund (WWF)</h4>
            <p className="text-sm text-gray-400 mt-1">wwf.org — Глобальные программы защиты лесов и биоразнообразия</p>
          </div>
          <div className="p-4 bg-slate-700/50 rounded-lg">
            <h4 className="font-bold text-green-400">Rainforest Alliance</h4>
            <p className="text-sm text-gray-400 mt-1">rainforest-alliance.org — Сертификация устойчивого лесопользования</p>
          </div>
          <div className="p-4 bg-slate-700/50 rounded-lg">
            <h4 className="font-bold text-green-400">Global Forest Watch</h4>
            <p className="text-sm text-gray-400 mt-1">globalforestwatch.org — Платформа мониторинга лесов</p>
          </div>
          <div className="p-4 bg-slate-700/50 rounded-lg">
            <h4 className="font-bold text-green-400">Greenpeace Forest Campaign</h4>
            <p className="text-sm text-gray-400 mt-1">greenpeace.org — Кампании против незаконной вырубки</p>
          </div>
        </div>
      </div>
    )
  },
  'methods': {
    title: 'Методы восстановления лесов',
    content: (
      <div className="space-y-4">
        <p>Эффективное лесовосстановление требует научного подхода и учета местных экологических условий.</p>
        <h4 className="text-lg font-bold text-green-400 mt-6">Основные методы:</h4>
        <div className="space-y-3">
          <div className="p-3 bg-slate-700/50 rounded">
            <span className="font-bold">Естественное возобновление</span> — создание условий для самовосстановления леса
          </div>
          <div className="p-3 bg-slate-700/50 rounded">
            <span className="font-bold">Искусственное лесоразведение</span> — посадка саженцев и посев семян
          </div>
          <div className="p-3 bg-slate-700/50 rounded">
            <span className="font-bold">Агролесоводство</span> — сочетание деревьев с сельскохозяйственными культурами
          </div>
        </div>
        <h4 className="text-lg font-bold text-green-400 mt-6">Рекомендуемые виды для Байкальского региона:</h4>
        <ul className="list-disc list-inside space-y-2 text-gray-300">
          <li>Сосна обыкновенная (Pinus sylvestris)</li>
          <li>Лиственница сибирская (Larix sibirica)</li>
          <li>Кедр сибирский (Pinus sibirica)</li>
          <li>Ель сибирская (Picea obovata)</li>
        </ul>
      </div>
    )
  }
};

function WikiPage() {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  return (
    <div className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
          </div>
          <h2 className="text-4xl font-bold">Лесная Wiki</h2>
        </div>

        <div className="flex flex-row flex-wrap lg:flex-nowrap gap-8 justify-between">
          <div 
            className="card hover:border-green-500/50 transition cursor-pointer flex-1 min-w-[300px]"
            onClick={() => setActiveModal('save-forests')}
          >
            <h4 className="text-xl font-bold mb-3">Сохранение лесов мира</h4>
            <p className="text-gray-400 mb-4 text-sm">Базовые знания о методах защиты лесных экосистем и международные стандарты мониторинга.</p>
            <span className="text-green-400 text-sm font-medium">Подробнее →</span>
          </div>
          <div 
            className="card hover:border-green-500/50 transition cursor-pointer flex-1 min-w-[300px]"
            onClick={() => setActiveModal('funds')}
          >
            <h4 className="text-xl font-bold mb-3">Специализированные фонды</h4>
            <p className="text-gray-400 mb-4 text-sm">Список организаций и фондов, занимающихся восстановлением лесов и борьбой с вырубкой.</p>
            <span className="text-green-400 text-sm font-medium">Список сайтов →</span>
          </div>
          <div 
            className="card hover:border-green-500/50 transition cursor-pointer flex-1 min-w-[300px]"
            onClick={() => setActiveModal('methods')}
          >
            <h4 className="text-xl font-bold mb-3">Методы восстановления</h4>
            <p className="text-gray-400 mb-4 text-sm">Как правильно проводить лесовосстановление и какие виды деревьев наиболее эффективны.</p>
            <span className="text-green-400 text-sm font-medium">Руководство →</span>
          </div>
        </div>

        <div className="mt-20">
          <h3 className="text-2xl font-bold mb-8">Медиа-материалы</h3>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="card overflow-hidden">
              <div className="aspect-video bg-slate-700 flex items-center justify-center">
                <span className="text-gray-500">Видео: Мониторинг лесов со спутника</span>
              </div>
              <div className="p-4">
                <h4 className="font-bold mb-2">Спутниковый мониторинг лесов</h4>
                <p className="text-sm text-gray-400">Как работают системы дистанционного зондирования для отслеживания состояния лесов.</p>
              </div>
            </div>
            <div className="card overflow-hidden">
              <div className="aspect-video bg-slate-700 flex items-center justify-center">
                <span className="text-gray-500">Видео: Восстановление после пожаров</span>
              </div>
              <div className="p-4">
                <h4 className="font-bold mb-2">Восстановление экосистем</h4>
                <p className="text-sm text-gray-400">Процесс естественного и искусственного восстановления лесов после пожаров.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeModal && modalContents[activeModal] && (
        <div 
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setActiveModal(null)}
        >
          <div 
            className="bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700 flex items-center justify-between sticky top-0 bg-slate-800">
              <h3 className="text-xl font-bold">{modalContents[activeModal].title}</h3>
              <button 
                onClick={() => setActiveModal(null)}
                className="text-gray-400 hover:text-white transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="p-6 text-gray-300">
              {modalContents[activeModal].content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WikiPage;
