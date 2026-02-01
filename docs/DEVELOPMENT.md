# Руководство по разработке

## Модульная архитектура

### Структура frontend (client/)
```
client/src/
├── api/           # API клиенты
│   ├── client.ts  # Базовый HTTP клиент
│   ├── health.ts  # Health check
│   ├── analytics.ts
│   ├── stac.ts
│   └── titiler.ts
├── components/    # UI компоненты
│   ├── StatusIndicator.ts
│   └── MapContainer.ts
├── utils/         # Утилиты
│   └── devAlerts.ts
├── types/         # TypeScript интерфейсы
│   └── index.ts
└── main.ts        # Точка входа
```

### Структура backend (src/)
```
src/
├── config/        # Конфигурация
├── models/        # Модели данных
├── routes/        # API маршруты
├── services/      # Бизнес-логика
└── utils/         # Утилиты
    ├── devAlerts.ts
    └── stubs.ts
```

## Система заглушек (Stubs)

Для нереализованных функций используйте заглушки из `src/utils/stubs.ts`:

```typescript
import { createStub, satelliteImageProcessing } from './utils/stubs';

// Использование готовых заглушек
const result = satelliteImageProcessing.analyzeNDVI();
// { success: false, isStub: true, error: "..." }

// Создание новой заглушки
const myStub = createStub<MyType>('functionName', defaultValue);
```

### Категории заглушек:
- **satelliteImageProcessing** - NDVI, детекция изменений, классификация
- **mlPredictions** - предсказание пожаров, вырубок
- **reportGeneration** - экспорт PDF, Excel, GeoJSON

## Система алертов разработки

### Backend (src/utils/devAlerts.ts)
```typescript
import { devAlert, AlertLevel, todo, stub, needsWork } from './utils/devAlerts';

// Уровни алертов
devAlert(AlertLevel.TODO, 'Добавить валидацию', 'routes/api.ts');
devAlert(AlertLevel.WARNING, 'Нужна оптимизация', 'services/db.ts');
devAlert(AlertLevel.STUB, 'Заглушка', 'services/ml.ts');
devAlert(AlertLevel.CRITICAL, 'Срочно исправить', 'config/db.ts');

// Сокращенные функции
todo('Добавить кэширование');
stub('processImage');
needsWork('База данных', 'Добавить индексы');

// Вывод сводки
printAlertsSummary();
```

### Frontend (client/src/utils/devAlerts.ts)
```typescript
import { devAlert, AlertLevel, showAlertsSummary } from './utils/devAlerts';

// Алерты выводятся в консоль браузера с цветовой маркировкой
devAlert(AlertLevel.WARNING, 'Компонент не реализован', 'MapContainer.ts');

// Сводка в конце загрузки
showAlertsSummary();
```

### Уровни алертов:
| Уровень | Описание | Цвет консоли |
|---------|----------|--------------|
| INFO | Информация | серый |
| WARNING | Требует внимания | оранжевый |
| TODO | Запланировано | желтый |
| STUB | Заглушка | голубой |
| CRITICAL | Срочно | красный |

## Тестирование

### Запуск тестов
```bash
npm test           # Запуск всех тестов
npm test -- --watch  # Watch режим
npm test -- --coverage  # С покрытием
```

### Структура тестов
```
tests/
├── setup.ts       # Настройка Jest
└── services/
    └── databaseService.test.ts
```

### Написание тестов
```typescript
import { describe, it, expect } from '@jest/globals';

describe('MyService', () => {
  it('should do something', async () => {
    const result = await myService.doSomething();
    expect(result).toBeDefined();
  });
});
```

## Команды разработки

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск backend (порт 3000) |
| `npm run dev:client` | Запуск frontend (порт 5000) |
| `npm test` | Запуск тестов |
| `npm run build` | Сборка проекта |

## TODO области (с алертами)

- [ ] Интеграция карты (Leaflet/MapLibre)
- [ ] STAC API поиск
- [ ] TiTiler COG preview
- [ ] Обработчики навигации
- [ ] Функции экспорта (PDF, Excel, GeoJSON)
- [ ] Алгоритмы обработки спутниковых снимков
- [ ] ML предсказания пожарного риска
