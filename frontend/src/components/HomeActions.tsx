import { Link } from 'react-router-dom';

interface ActionCardProps {
  href: string;
  icon: string;
  title: string;
  description: string;
  accent: string;
}

function ActionCard({ href, icon, title, description, accent }: ActionCardProps) {
  const className = `card stat-card block p-5 transition-colors ${accent}`;
  const body = (
    <>
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <p className="mt-3 font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </>
  );
  return href.startsWith('/')
    ? <Link to={href} className={className}>{body}</Link>
    : <a href={href} className={className}>{body}</a>;
}

/** The home page's three entry points: map, incidents, analytics/sources (future.md §4, #6). */
function HomeActions() {
  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-3">
      <ActionCard
        href="#map"
        icon="🗺️"
        title="Открыть карту"
        description="Пожары, потери леса, ООПТ и границы районов"
        accent="hover:border-green-500/50"
      />
      <ActionCard
        href="/incidents"
        icon="🔥"
        title="Инциденты"
        description="Лента подтверждаемых событий с фильтрами и картой"
        accent="hover:border-amber-500/50"
      />
      <ActionCard
        href="/analytics"
        icon="📊"
        title="Аналитика и источники"
        description="Динамика по регионам, статистика Рослесхоза, реестр источников"
        accent="hover:border-blue-500/50"
      />
    </div>
  );
}

export default HomeActions;
