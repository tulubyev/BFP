import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';

// Secondary pages load on demand — recharts alone is a large share of the bundle
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const WikiPage = lazy(() => import('./pages/WikiPage'));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'));
const MethodologyPage = lazy(() => import('./pages/MethodologyPage'));
const RegionReportPage = lazy(() => import('./pages/RegionReportPage'));

const pageFallback = <div className="px-4 py-8 text-sm text-slate-400">Загрузка…</div>;

function App() {
  return (
    <Suspense fallback={pageFallback}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="wiki" element={<WikiPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="methodology" element={<MethodologyPage />} />
          <Route path="regions/:iso/report" element={<RegionReportPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
