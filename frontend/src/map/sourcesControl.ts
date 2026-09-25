import L from 'leaflet';
import { formatFreshnessLabel, monitoredSources, STATE_COLOR, type SourceStatusEntry, type SourcesStatusResponse } from './sourcesStatus';

function sourceRow(entry: SourceStatusEntry): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 0';

  const dot = document.createElement('span');
  dot.style.cssText = `width:9px;height:9px;border-radius:50%;flex:0 0 auto;background:${STATE_COLOR[entry.state]}`;

  const label = document.createElement('span');
  label.textContent = `${entry.name} — ${formatFreshnessLabel(entry)}`;

  row.append(dot, label);
  return row;
}

function panelElement(sources: SourceStatusEntry[]): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = [
    'background:rgba(15,23,42,0.93)',
    'border:1px solid #334155',
    'border-radius:8px',
    'padding:8px 10px',
    'font-size:11px',
    'color:#cbd5e1',
    'min-width:215px',
    'pointer-events:auto',
    'backdrop-filter:blur(4px)',
  ].join(';');

  const title = document.createElement('p');
  title.style.cssText = 'font-weight:700;color:#fff;margin:0 0 6px 0;font-size:12px';
  title.textContent = 'Источники данных';
  root.append(title);

  if (sources.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'margin:0;color:#64748b';
    empty.textContent = 'Загрузка…';
    root.append(empty);
    return root;
  }

  for (const source of sources) root.append(sourceRow(source));
  return root;
}

/** Compact control listing each monitored source's freshness (colour dot + relative age). */
export function addSourcesControl(map: L.Map): L.Control {
  const SourcesControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const container = L.DomUtil.create('div', '');
      container.append(panelElement([]));
      fetch('/api/sources/status')
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((res: SourcesStatusResponse) => {
          if (!res.success) return;
          container.replaceChildren(panelElement(monitoredSources(res.sources)));
        })
        .catch(err => console.warn('Sources status fetch failed:', err));
      return container;
    },
  });
  const control = new SourcesControl();
  control.addTo(map);
  return control;
}
