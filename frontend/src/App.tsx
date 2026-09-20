import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import AnalyticsPage from './pages/AnalyticsPage';
import WikiPage from './pages/WikiPage';
import IncidentsPage from './pages/IncidentsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="wiki" element={<WikiPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
