import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built JS/CSS are served from the CDN when CDN_URL is set at build time (e.g. https://cdn.forestwatch.ru)
const cdnUrl = process.env.CDN_URL?.replace(/\/+$/, '');

export default defineConfig({
  plugins: [react()],
  define: {
    __CDN_URL__: JSON.stringify(cdnUrl ?? ''),
  },
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (cdnUrl && ['html', 'js', 'css'].includes(hostType)) return `${cdnUrl}/${filename}`;
      return undefined;
    },
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/tiles': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
