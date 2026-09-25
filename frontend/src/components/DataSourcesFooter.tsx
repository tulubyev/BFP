/** Attribution/links footer for the home page's data sources (future.md §3 — origin for every number). */
function DataSourcesFooter() {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
        <span>Потери леса: <a href="https://www.globalforestwatch.org" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">Hansen/UMD · GFW</a></span>
        <span>·</span>
        <span>ООПТ: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">OSM © contributors (ODbL)</a></span>
        <span>·</span>
        <span>Пожары: <a href="https://firms.modaps.eosdis.nasa.gov" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">NASA FIRMS VIIRS</a></span>
        <span>·</span>
        <span>Статистика: <a href="https://rosleshoz.gov.ru/opendata/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">Рослесхоз opendata</a></span>
      </div>
      <a href="/api/external/sources" target="_blank" rel="noopener noreferrer"
        className="text-xs text-blue-600 transition-colors hover:text-blue-400">
        Все источники →
      </a>
    </div>
  );
}

export default DataSourcesFooter;
