import { useLocation } from 'react-router-dom';

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
        {location.pathname === '/' && (
          <p className="mt-2">Данные: Sentinel-2, Landsat 8/9 | Технологии: TypeScript, React, Tailwind CSS</p>
        )}
      </div>
    </footer>
  );
}

export default Footer;
