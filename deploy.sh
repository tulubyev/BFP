#!/usr/bin/env bash
# Деплой forestwatch.ru на VPS: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Нет .env — скопируй .env.example и заполни"; exit 1; }

git pull origin main
docker compose -f docker-compose.prod.yml up -d --build

echo "Жду healthcheck..."
for i in $(seq 1 20); do
  status=$(docker inspect -f '{{.State.Health.Status}}' forestwatch-app 2>/dev/null || echo none)
  [ "$status" = healthy ] && { echo "OK: forestwatch-app healthy"; exit 0; }
  sleep 3
done
echo "FAIL: контейнер не healthy"; docker logs --tail 50 forestwatch-app; exit 1
