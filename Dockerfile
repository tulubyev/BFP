# ── Build: backend (tsc) + frontend (vite → public/) ──
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json jest.config.js ./
COPY backend ./backend
COPY frontend ./frontend
COPY tests ./tests
# Optional: serve built assets from a CDN (see docker-compose.prod.yml)
ARG CDN_URL=""
ENV CDN_URL=$CDN_URL
# Build fails (and deploy stops) on type errors or failing tests
RUN npx tsc \
 && (cd frontend && npx tsc --noEmit -p . && npx vite build) \
 && npx jest --ci --silent

# ── Runtime ──
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
USER node
CMD ["node", "dist/server.js"]
