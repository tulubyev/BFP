# 🌲 БайкалЛес ГИС

Геоинформационная система мониторинга лесных ресурсов Байкальской природной территории на основе спутниковых данных.

## 📁 Структура проекта

```
baikal-forest-gis/
│
├── 📄 index.html              # Главная страница (демо)
├── 📄 geo-analysis.html       # Методики ДЗЗ анализа
├── 📄 tech-stack.html         # Технологический стек
├── 📄 architecture.html       # Архитектурная диаграмма
├── 📄 mvp-deployment.html     # Руководство развертывания
│
├── 📄 styles.css              # Общие стили
├── 📄 app.js                  # Клиентская логика (браузер)
│
├── 📄 package.json            # Зависимости npm
├── 📄 tsconfig.json           # Конфигурация TypeScript
│
└── 📁 src/                    # TypeScript исходники
    │
    ├── 📄 types.ts            # Общие типы и интерфейсы
    ├── 📄 config.ts           # Конфигурация и константы
    ├── 📄 state.ts            # State management
    ├── 📄 charts.ts           # Инициализация графиков
    ├── 📄 main.ts             # Точка входа frontend
    │
    ├── 📁 ui/                 # UI компоненты
    │   ├── 📄 modals.ts       # Модальные окна
    │   ├── 📄 layers.ts       # Управление слоями карты
    │   └── 📄 map.ts          # Управление картой
    │
    ├── 📁 processing/         # Алгоритмы обработки
    │   ├── 📄 spectralIndices.ts  # Калькулятор индексов (NDVI, NBR, etc.)
    │   └── 📄 landtrendr.ts       # LandTrendr алгоритм
    │
    └── 📁 api/                # Backend API
        ├── 📄 server.ts       # Fastify сервер
        │
        ├── 📁 routes/         # API маршруты
        │   └── 📄 events.ts   # CRUD для событий (пожары, рубки)
        │
        └── 📁 services/       # Бизнес-логика
            ├── 📄 titiler.ts  # Интеграция с TiTiler
            └── 📄 storage.ts  # Работа с S3 (Yandex/Beget)
```

## 🚀 Быстрый старт

### Требования
- Node.js 18+
- PostgreSQL 15 + PostGIS 3.3
- Redis 7
- Docker & Docker Compose

### Установка

```bash
# Клонирование репозитория
git clone https://github.com/your-org/baikal-forest-gis.git
cd baikal-forest-gis

# Установка зависимостей
npm install

# Копирование переменных окружения
cp .env.example .env

# Запуск в режиме разработки
npm run dev
```

### Docker Compose (полный стек)

```bash
# Запуск всех сервисов
docker-compose up -d

# Проверка логов
docker-compose logs -f api

# Остановка
docker-compose down
```

## 📊 Ключевые модули

### Спектральные индексы (`src/processing/spectralIndices.ts`)

```typescript
import { SpectralIndexCalculator } from './processing/spectralIndices';

// Расчёт NDVI
const ndvi = SpectralIndexCalculator.ndvi({
    B04: 1200,  // Red
    B08: 3500   // NIR
});

console.log(ndvi.value);          // 0.489
console.log(ndvi.classification); // 'moderate_vegetation'
```

### LandTrendr (`src/processing/landtrendr.ts`)

```typescript
import { createBaikalLandTrendr } from './processing/landtrendr';

const processor = createBaikalLandTrendr();
const result = processor.process(timeSeriesData);

console.log(result.disturbances);  // Обнаруженные нарушения
console.log(result.recoveries);    // Зоны восстановления
```

### TiTiler сервис (`src/api/services/titiler.ts`)

```typescript
import { createTiTilerService, SPECTRAL_INDICES } from './services/titiler';

const titiler = createTiTilerService('http://localhost:8000');

// Получить URL для NDVI тайлов
const ndviTileUrl = titiler.buildIndexTileUrl(
    'https://storage.yandexcloud.net/baikal-cog/sentinel2/2024/scene.tif',
    'NDVI'
);
```

### S3 Storage (`src/api/services/storage.ts`)

```typescript
import { createYandexStorage } from './services/storage';

const storage = createYandexStorage(
    process.env.YC_ACCESS_KEY,
    process.env.YC_SECRET_KEY,
    'baikal-forest-cog'
);

// Загрузка COG файла
await storage.uploadCOG('scene_id', 'sentinel2', 2024, buffer);

// Получить URL для TiTiler
const url = storage.getTiTilerUrl('cog/sentinel2/2024/scene.tif');
```

## 🗄️ База данных

### Инициализация PostGIS

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;
CREATE SCHEMA IF NOT EXISTS gis;

-- Таблица событий
CREATE TABLE gis.forest_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20),
    detected_date DATE NOT NULL,
    area_ha NUMERIC(10,2),
    geom GEOMETRY(Polygon, 4326),
    metadata JSONB DEFAULT '{}'
);

-- Пространственный индекс
CREATE INDEX idx_events_geom ON gis.forest_events USING GIST (geom);
```

## 🌐 API Endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/api/events/geojson` | Получить события в GeoJSON |
| GET | `/api/events/:id` | Получить событие по ID |
| POST | `/api/events` | Создать новое событие |
| PATCH | `/api/events/:id` | Обновить событие |
| DELETE | `/api/events/:id` | Удалить событие |
| GET | `/api/events/stats` | Статистика событий |
| GET | `/api/tiles/url` | Получить URL тайлов |
| GET | `/api/tiles/info` | Информация о COG |
| GET | `/health` | Health check |

## 📦 Технологический стек

### Frontend
- **MapLibre GL JS** 3.6.2 — Картографическая библиотека
- **Chart.js** 4.4.1 — Визуализация данных
- **Tailwind CSS** 3.4.0 — Стилизация
- **Turf.js** 6.5.0 — Геопространственный анализ

### Backend
- **Fastify** 4.25.2 — Web framework
- **TypeScript** 5.3.3 — Типизация
- **TypeORM** 0.3.19 — ORM
- **BullMQ** 5.1.1 — Очереди задач

### Infrastructure
- **PostgreSQL** 15 + **PostGIS** 3.3
- **Redis** 7
- **TiTiler** — Динамические тайлы
- **Yandex Object Storage** — S3 хранилище

## 💰 Бюджет MVP

| Компонент | Стоимость/мес |
|-----------|---------------|
| VPS (4 vCPU / 16 GB) | ~7,500 ₽ |
| S3 Storage (500 GB) | ~1,000 ₽ |
| Домен + SSL | ~200 ₽ |
| **ИТОГО** | **~8,700 ₽** |

## 📄 Лицензия

MIT License

## 👥 Команда

BaikalForest GIS Team — [api@baikal-forest.ru](mailto:api@baikal-forest.ru)
