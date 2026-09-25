import { useEffect, useState } from 'react';
import { getIncidents } from '../api/incidents';
import { firmsUrl } from '../map/firms';
import type { SourceStatusEntry, SourcesStatusResponse } from '../map/sourcesStatus';
import HomeHero from '../components/HomeHero';
import HomeActions from '../components/HomeActions';
import MonitoringMap from '../components/MonitoringMap';
import RosleshozStats, { type RosleskhozSummary } from '../components/RosleshozStats';
import DataSourcesFooter from '../components/DataSourcesFooter';
import { countActiveFirmsIncidents, errorStat, readyStat, loadingStat, findSourceStatus, type Stat } from '../utils/homeStats';

const FIRE_INCIDENTS_LIMIT = 100;

function HomePage() {
  const [rosleshoz, setRosleshoz] = useState<RosleskhozSummary | null>(null);
  const [activeFires, setActiveFires] = useState<Stat<number>>(loadingStat);
  const [hotspots24h, setHotspots24h] = useState<Stat<number>>(loadingStat);
  const [firmsSource, setFirmsSource] = useState<SourceStatusEntry | null>(null);

  useEffect(() => {
    fetch('/api/external/rosleshoz/summary')
      .then(r => r.json())
      .then(res => { if (res.success) setRosleshoz(res.data); })
      .catch(console.error);

    getIncidents({ type: 'fire', sort: 'date_desc', limit: FIRE_INCIDENTS_LIMIT })
      .then(result => setActiveFires(result.success ? readyStat(countActiveFirmsIncidents(result.data)) : errorStat))
      .catch(() => setActiveFires(errorStat));

    fetch(firmsUrl('baikal'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(res => setHotspots24h(res.success ? readyStat(res.count as number) : errorStat))
      .catch(() => setHotspots24h(errorStat));

    fetch('/api/sources/status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((res: SourcesStatusResponse) => {
        if (res.success) setFirmsSource(findSourceStatus(res.sources, 'firms'));
      })
      .catch(err => console.warn('Sources status fetch failed:', err));
  }, []);

  return (
    <div className="px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <HomeHero activeFires={activeFires} hotspots24h={hotspots24h} firmsSource={firmsSource} />
        <HomeActions />
        <MonitoringMap />
        <RosleshozStats data={rosleshoz} />
        <DataSourcesFooter />
      </div>
    </div>
  );
}

export default HomePage;
