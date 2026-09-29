import L from 'leaflet';
import {
  defaultPanelCollapsed, readPanelCollapsed, writePanelCollapsed, type PanelId, type StorageLike,
} from './mapLayout';

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null; // access itself can throw when site data is blocked
  }
}

/**
 * Puts a clickable title bar in front of `body` inside a Leaflet control container: a click folds
 * the body away and back. The state is remembered per panel; phones start folded. The container
 * also stops wheel and click events from reaching the map (scrolling a panel must not zoom it).
 */
export function makeCollapsible(
  container: HTMLElement, body: HTMLElement, id: PanelId, title: string, titleColor = '#fff',
): void {
  const collapsed = readPanelCollapsed(id, defaultPanelCollapsed(window.innerWidth), browserStorage());

  const bar = document.createElement('button');
  bar.type = 'button';
  bar.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between', 'gap:10px', 'width:100%',
    'background:none', 'border:0', 'padding:0', 'margin:0', 'cursor:pointer', 'font:inherit',
    'font-weight:700', `color:${titleColor}`, 'font-size:13px', 'text-align:left',
  ].join(';');
  const label = document.createElement('span');
  label.textContent = title;
  const chevron = document.createElement('span');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.style.cssText = 'color:#94a3b8;font-size:11px';
  bar.append(label, chevron);

  const apply = (isCollapsed: boolean) => {
    body.style.display = isCollapsed ? 'none' : '';
    bar.setAttribute('aria-expanded', String(!isCollapsed));
    bar.title = isCollapsed ? `Показать: ${title}` : `Свернуть: ${title}`;
    chevron.textContent = isCollapsed ? '▸' : '▾';
    bar.style.marginBottom = isCollapsed ? '0' : '8px';
  };
  apply(collapsed);

  bar.addEventListener('click', () => {
    const next = body.style.display !== 'none';
    apply(next);
    writePanelCollapsed(id, next, browserStorage());
  });

  container.insertBefore(bar, body);
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
}

/** Leaflet's layer list: fold everything but the title bar. */
export function makeLayersControlCollapsible(control: L.Control.Layers): void {
  const container = control.getContainer();
  if (!container) return;
  const list = container.querySelector<HTMLElement>('.leaflet-control-layers-list');
  if (!list) return;
  // Leaflet's own layer list is light: a dark title, unlike the dark legend and sources panels
  makeCollapsible(container, list, 'layers', 'Слои карты', '#111827');
}
