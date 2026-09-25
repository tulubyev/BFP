# #11 — история FIRMS и инциденты-пожары из данных

Дата: 2026-09-25. Связано: future.md §6 «История и фоновые загрузки», §7 «Развитие инцидентов».

## Проблема

Инциденты (`gis.forest_changes`) — 4 тестовые записи 2023–2024 гг. Система не создаёт событий из
реальных данных: термоточки FIRMS живут только в Redis (снимок за 24 ч) и исчезают.

## Что уже есть

- `gis.fire_hotspots` (id, source, satellite, latitude, longitude, brightness, brightness_t31, frp,
  scan, track, acquisition_date, acquisition_time, confidence, confidence_pct, version, daynight,
  processed, alert_id, created_at) — 4 тестовые строки. Права INSERT у приложения есть.
- `gis.forest_changes` — лента инцидентов, API `GET /api/monitoring/forest-changes` (+ кэш и режим
  `live|cache` из PR #1). Есть `metadata jsonb`, `center_lat/lng`, `bbox_*`, `geojson text`.
- Фоновая задача `firms` (каждые 30 мин) кладёт свежий снимок России в Redis.

## Решения

1. **Накопление.** После каждого успешного обновления FIRMS все точки России пишутся в
   `fire_hotspots` (source `firms_viirs_nrt`). Повторный импорт не создаёт дублей:
   `INSERT … ON CONFLICT DO NOTHING` по уникальному индексу наблюдения.
2. **Миграция `database/migrations/011_firms_history.sql`** — только добавочная, идемпотентная:
   - `CREATE UNIQUE INDEX IF NOT EXISTS fire_hotspots_observation_uniq ON gis.fire_hotspots
     (satellite, acquisition_date, acquisition_time, latitude, longitude)`;
   - индексы `fire_hotspots (acquisition_date)` и `forest_changes (source, detected_date)`.
   Применяется на боевой базе **вручную после согласия владельца, до вливания кода**.
3. **Кластеры → инциденты (только Байкальский регион: RU-IRK, RU-BU, RU-ZAB).** Регион точки —
   point-in-polygon по `frontend/public/data/boundaries/ru-regions.<версия>.geojson` (файл есть в
   образе как `public/data/boundaries/…`). Окно — последние 72 ч. Кластер: точки, связанные цепочкой
   соседей ≤ 2 км (single-linkage). Событием становится кластер из ≥ 2 точек или 1 точка высокой
   достоверности (`confidence = high`).
4. **Сопоставление с существующими инцидентами.** Кластер, чей охват ≤ 2 км от охвата активного
   FIRMS-инцидента (последняя точка ≤ 72 ч назад), **обновляет** его; иначе создаётся новый.
   Ключ стабильности — `metadata.cluster_key` (id первой точки).
5. **Поля инцидента.** `change_type 'fire'`, `source 'firms'`, `satellite` — список спутников,
   `detected_date` — дата первой точки, `center_*`/`bbox_*` — по точкам, `confidence` — доля точек
   высокой достоверности, `area_ha` — **оценка сверху**: число уникальных пикселей × 14,06 га
   (пиксель VIIRS 375 м), `metadata`: `{method: 'firms-cluster-v1', cluster_key, region, region_iso,
   hotspot_count, frp_max, frp_sum, first_seen, last_seen, status: 'active'|'inactive'}`.
   Статус `inactive`, если новых точек нет 48 ч. Тестовые записи (без `metadata.method`) не трогать.
6. **API и интерфейс.** Регион в ленте: `COALESCE(<регион из forest_areas>, metadata->>'region')`.
   Карточка и модалка FIRMS-инцидента: «NASA FIRMS, кластер N термоточек», площадь с пометкой
   «оценка по пикселям 375 м, сверху», статус активен/затих, даты первой и последней точки.
   Лента на главной (окно 90 дней) начнёт показывать эти события сама.
7. **Журнал.** Задача пишет в журнал источников (PR #2) число записанных точек и
   созданных/обновлённых инцидентов.

## Проверка

Юнит-тесты: кластеризация (цепочки, пороги, антимеридиан не нужен — Байкал), сопоставление,
оценка площади, построение SQL (параметры, ON CONFLICT), идемпотентность повторного прогона.
После деплоя: рост `fire_hotspots`, появление FIRMS-инцидентов в `/api/monitoring/forest-changes`.

## Вне рамок

Инциденты из DIST-ALERT, уведомления, хранение дольше 3 лет, слой инцидентов на карте.
