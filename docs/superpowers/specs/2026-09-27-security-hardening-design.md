# Защита API (future.md §13 «Безопасность»)

Дата: 2026-09-27. Повод: в проде найдена и закрыта SQL-инъекция через `?days=` в
`/api/monitoring/fire-hotspots*` (коммит 22e82b7, `backend/utils/queryParams.ts`). Роль БД
приложения не суперпользователь, но владеет всеми таблицами `gis` — любая новая инъекция опасна.
Access-логов Traefik нет.

## 1. Аудит SQL и ввода

- Пройти все `pool.query`/`client.query` в `backend/`: никаких значений из запроса в тексте SQL,
  только плейсхолдеры или белые списки (как `FOREST_CHANGES_SORT_COLUMNS`). Числа — через
  парсеры с пределами (`parseDays` и аналоги), строки-перечисления — через белые списки.
- Тест-страж: jest-тест, который сканирует исходники `backend/**/*.ts` и падает, если в строке
  SQL (`SELECT|INSERT|UPDATE|DELETE|WHERE|INTERVAL`) есть `${…}` с выражением не из белого
  списка констант (явный allowlist известных безопасных подстановок: `REGION_EXPR`,
  `notStaticSourceSql()`, `INCIDENT_METHOD`, номера плейсхолдеров `$${…}` и т. п.).

## 2. Старые эндпоинты без пользователей

Проверить, кто вызывает (grep `frontend/src`, тесты, документы), и удалить неиспользуемые из
`backend/routes/monitoring.ts`: `/forest-areas*`, `/monitoring-zones`, `/alerts`, `/statistics`,
`/spectral-indices/*` (POST calculate принимает произвольный JSON), `/external-services/info`,
`/fire-hotspots` и `/fire-hotspots/geojson` (сырые строки БД; карта берёт `/fire-hotspots/firms`),
`/lookup/:table`. Оставить только то, что использует фронтенд, экспорт, региональный сервис и
документированные внешние сценарии. Если что-то нужно оставить — предел строк и тесты.
Не трогать маршруты снимков (`/forest-changes/:id/imagery`, `/ndvi-series`) — их меняет
параллельная задача NDVI.

## 3. Ограничение частоты запросов

- `express-rate-limit` (MIT), хранилище в памяти (один контейнер). `app.set('trust proxy', 1)` —
  перед приложением ровно один прокси (Traefik); проверить, что `req.ip` — адрес клиента, а не
  Traefik (тест с `X-Forwarded-For`).
- Только `/api/*`: общий лимит 300 запросов/мин на IP; дорогие — 20/мин на IP: выгрузки
  `/api/export/*`, `/api/monitoring/forest-changes/:id/imagery` и `/ndvi-series`,
  `/api/regions*` при промахе кэша не выделять (всё равно кэш).
  `/tiles/*`, `/imagery/*` (PNG), `/assets/*`, `/data/*` не ограничивать — их тянет Beget CDN
  с небольшого числа адресов; у рендеров свой лимит параллельности.
- Ответ 429: JSON `{ success: false, error: 'Слишком много запросов, попробуйте через минуту' }`,
  заголовки `RateLimit-*` и `Retry-After`. `/health` не ограничивать (healthcheck Docker и CI).

## 4. Прочее

- `express.json({ limit: '100kb' })` (сейчас без предела), `urlencoded` не нужен.
- Исходящие запросы (FIRMS, Overpass, Рослесхоз, GFW, Earth Search): у всех есть таймауты —
  добавить предел размера ответа (`maxContentLength`/`maxBodyLength` у axios; для fetch —
  проверка `content-length` и счётчик байт), значения с запасом к реальным (Overpass ООПТ —
  десятки МБ, FIRMS CSV России — ~10 МБ; измерить по коду/журналу, не гадать).
- В `CLAUDE.md` (раздел Code conventions) — правило: значения из запроса только
  плейсхолдерами, числа через парсеры с пределами; тест-страж это проверяет.

## Тесты

Тест-страж SQL, rate limit (лимит, 429, `Retry-After`, исключения путей, `trust proxy`),
лимит тела JSON (413), пределы размеров исходящих ответов, удалённые маршруты → 404.

## Вне рамок (решения владельца)

Отдельная роль БД с минимальными правами для приложения (владелец таблиц — другая роль),
access-логи Traefik, WAF/лимиты на уровне Traefik.
