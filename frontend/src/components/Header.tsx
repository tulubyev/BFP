import { Link, useLocation } from 'react-router-dom';

function Header() {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path ? 'text-green-400' : 'text-gray-400 hover:text-green-400';
  };

  return (
    <header className="glass sticky top-0 z-50 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500/20 text-green-400 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold">ForestGIS</h1>
            <p className="text-xs text-gray-400">Спутниковый мониторинг</p>
          </div>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link to="/" className={`transition ${isActive('/')}`}>Карта</Link>
          <Link to="/analytics" className={`transition ${isActive('/analytics')}`}>Аналитика</Link>
          <Link to="/incidents" className={`transition ${isActive('/incidents')}`}>Инциденты</Link>
          <Link to="/wiki" className={`transition ${isActive('/wiki')}`}>Wiki</Link>
        </nav>
      </div>
    </header>
  );
}

export default Header;
