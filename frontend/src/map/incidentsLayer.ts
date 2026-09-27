import L from 'leaflet';
import {
  describeIncident,
  incidentActivity,
  incidentBounds,
  incidentPointRadius,
  incidentShape,
  incidentStyle,
  incidentsGeojsonUrl,
  isMapIncident,
  type IncidentFeatureProps,
} from './incidents';
import { popupElement } from './popup';

// Above the boundary panes (410–450), whose transparent fills would otherwise take the clicks
const PANE = 'incidents';
const PANE_Z_INDEX = 460;

interface Entry {
  props: IncidentFeatureProps;
  center: L.LatLng;
  point: L.CircleMarker;
  rect: L.Rectangle | null;
}

export interface IncidentsLayerOptions {
  /** The user opened (id) or closed (null) an incident's popup. */
  onSelect: (id: number | null) => void;
  /** A requested incident (select()) was looked up in freshly loaded data. */
  onResolved?: (id: number, found: boolean) => void;
}

export interface IncidentsLayer {
  overlay: L.LayerGroup;
  /**
   * Highlights an incident and opens its popup once data is loaded; `focus` also moves the view to
   * it (a link with an incident but no centre).
   */
  select(id: number, opts?: { focus?: boolean }): void;
  /** (Re)loads the data, cancelling a request still in flight. */
  reload(): void;
  /** Cancels a pending request (map teardown). */
  destroy(): void;
}

/**
 * «Инциденты»: FIRMS incidents of the last 30 days — the bbox outline from zoom 9, a centre point
 * below it; orange = active, grey dashed = died down. Data is fetched when the overlay is first
 * switched on. One popup per selection is opened on the map itself (not bound to a shape), so
 * swapping points and outlines on zoom does not close it.
 */
export function createIncidentsLayer(map: L.Map, control: L.Control.Layers, opts: IncidentsLayerOptions): IncidentsLayer {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = String(PANE_Z_INDEX);
  const renderer = L.canvas({ padding: 0.5, pane: PANE });

  const overlay = L.layerGroup();
  const points = L.layerGroup(); // centre points of incidents with a bbox, below INCIDENT_BBOX_MIN_ZOOM
  const rects = L.layerGroup(); // their bbox outlines from INCIDENT_BBOX_MIN_ZOOM
  const lonePoints = L.layerGroup(); // incidents without a bbox: a point at every zoom
  overlay.addLayer(lonePoints);
  control.addOverlay(overlay, 'Инциденты FIRMS — 30 дней');

  const entries = new Map<number, Entry>();
  let selectedId: number | null = null;
  let pending: { id: number; focus: boolean } | null = null;
  let controller: AbortController | null = null;
  let loaded = false;
  let popup: L.Popup | null = null;

  const restyle = (entry: Entry) => {
    const style = incidentStyle(incidentActivity(entry.props), entry.props.id === selectedId);
    entry.point.setStyle(style);
    entry.rect?.setStyle(style);
  };

  const setSelected = (id: number | null) => {
    const previous = selectedId;
    selectedId = id;
    for (const key of [previous, id]) {
      const entry = key === null ? undefined : entries.get(key);
      if (entry) restyle(entry);
    }
  };

  const openPopup = (entry: Entry, autoPan: boolean) => {
    const { id } = entry.props;
    setSelected(id);
    const { title, rows, link } = describeIncident(entry.props);
    const opened = L.popup({ autoPan, offset: [0, -4] })
      .setLatLng(entry.center)
      .setContent(popupElement(title, rows, { titleColor: '#f97316', link: { ...link, newTab: false } }));
    opened.on('remove', () => {
      if (popup === opened) popup = null;
      if (selectedId !== id) return; // replaced by another incident's popup
      setSelected(null);
      opts.onSelect(null);
    });
    popup = opened;
    opened.openOn(map);
  };

  const sync = () => {
    const showRects = incidentShape(map.getZoom()) === 'bbox';
    const [on, off] = showRects ? [rects, points] : [points, rects];
    if (!overlay.hasLayer(on)) overlay.addLayer(on);
    if (overlay.hasLayer(off)) overlay.removeLayer(off);
  };

  const resolvePending = () => {
    if (!pending || !loaded) return;
    const { id, focus } = pending;
    pending = null;
    const entry = entries.get(id);
    opts.onResolved?.(id, Boolean(entry));
    if (!entry) return;
    if (focus) {
      const bounds = incidentBounds(entry.props);
      if (bounds) map.fitBounds(bounds, { maxZoom: 12, padding: [40, 40] });
      else map.setView(entry.center, 10);
    }
    openPopup(entry, false);
  };

  const render = (features: GeoJSON.Feature[]) => {
    points.clearLayers();
    rects.clearLayers();
    lonePoints.clearLayers();
    entries.clear();
    for (const feature of features) {
      const props = feature.properties as IncidentFeatureProps | null;
      if (!props || !isMapIncident(props) || feature.geometry?.type !== 'Point') continue;
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const activity = incidentActivity(props);
      const center = L.latLng(lat, lng);
      const style = incidentStyle(activity, props.id === selectedId);
      const point = L.circleMarker(center, { ...style, radius: incidentPointRadius(activity), renderer, pane: PANE });
      const bounds = incidentBounds(props);
      const rect = bounds ? L.rectangle(bounds, { ...style, renderer, pane: PANE }) : null;
      const entry: Entry = { props, center, point, rect };
      const onClick = () => {
        openPopup(entry, true);
        opts.onSelect(props.id);
      };
      point.on('click', onClick);
      rect?.on('click', onClick);
      if (rect) {
        points.addLayer(point);
        rects.addLayer(rect);
      } else {
        lonePoints.addLayer(point);
      }
      entries.set(props.id, entry);
    }
  };

  const reload = () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    fetch(incidentsGeojsonUrl(), { signal: current.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: GeoJSON.FeatureCollection) => {
        if (current.signal.aborted) return;
        render(Array.isArray(data?.features) ? data.features : []);
        loaded = true;
        sync();
        resolvePending();
      })
      .catch(err => {
        if (current.signal.aborted) return;
        console.warn('Incidents layer fetch failed:', err);
        loaded = false; // retried the next time the overlay is switched on
        if (pending) {
          opts.onResolved?.(pending.id, false);
          pending = null;
        }
      })
      .finally(() => {
        if (controller === current) controller = null;
      });
  };

  overlay.on('add', () => {
    if (!loaded && !controller) reload();
  });
  overlay.on('remove', () => {
    if (popup) map.closePopup(popup);
  });
  map.on('zoomend', sync);
  sync();

  return {
    overlay,
    select(id, selectOpts = {}) {
      pending = { id, focus: Boolean(selectOpts.focus) };
      resolvePending();
    },
    reload,
    destroy() {
      controller?.abort();
      controller = null;
    },
  };
}
