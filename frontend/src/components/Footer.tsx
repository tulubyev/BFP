import { Link, useLocation } from 'react-router-dom';

function Footer() {
  const location = useLocation();

  const getFooterText = () => {
    switch (location.pathname) {
      case '/analytics':
        return 'ForestGIS — Аналитический центр';
      case '/wiki':
        return 'ForestGIS — Wiki & Media';
      default:
        return 'ForestGIS — Система мониторинга лесных ресурсов Байкальского региона';
    }
  };

  return (
    <footer className="glass mt-16 py-8">
      <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
        <p>{getFooterText()}</p>
        <p className="mt-2"><Link to="/methodology" className="text-green-400 hover:text-green-300">Методология и источники данных</Link></p>
        {location.pathname === '/' && (
          <p className="mt-2">Данные: Sentinel-2, Landsat 8/9 | Технологии: TypeScript, React, Tailwind CSS</p>
        )}
      </div>
    </footer>
  );
}

export default Footer;
