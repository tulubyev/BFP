import {
  BASE_IDS,
  DEFAULT_BASE,
  DEFAULT_CENTER,
  DEFAULT_OVERLAYS,
  DEFAULT_ZOOM,
  LEGACY_TARGET_ZOOM,
  OVERLAY_IDS,
  debounce,
  formatCoord,
  mapShareUrl,
  mapStateQuery,
  parseBase,
  parseIncident,
  parseLat,
  parseLng,
  parseMapState,
  parseOverlays,
  parseZoom,
  sameMapState,
  serializeMapState,
  wrapLng,
  type MapState,
} from '../frontend/src/map/mapState';

const parse = (query: string) => parseMapState(new URLSearchParams(query));

describe('map state: round trip', () => {
  const states: MapState[] = [
    { center: [52.2851, 104.2834], zoom: 9, overlays: ['loss', 'regions', 'incidents'], base: 'satellite', incident: 42 },
    { center: [53.5, 108], zoom: 5, overlays: [...DEFAULT_OVERLAYS], base: 'dark', incident: null },
    { center: [-12.34567, -170.5], zoom: 19, overlays: [], base: 'osm', incident: null },
    { center: [66.1, -172.9], zoom: 1, overlays: [...OVERLAY_IDS], base: 'dark', incident: 9007199254740991 },
  ];

  it.each(states)('parse(serialize(state)) restores %j', state => {
    const parsed = parseMapState(serializeMapState(state));
    expect(sameMapState(parsed, state)).toBe(true);
    expect(parsed.center).toEqual(state.center);
    expect(parsed.zoom).toBe(state.zoom);
    expect(parsed.overlays).toEqual(OVERLAY_IDS.filter(id => state.overlays.includes(id)));
    expect(parsed.base).toBe(state.base);
    expect(parsed.incident).toBe(state.incident);
    expect(parsed.hasCenter).toBe(true);
  });

  it('serialize(parse(query)) is stable', () => {
    const query = 'lat=52.28510&lng=104.28340&z=9&layers=loss,regions,incidents&base=satellite&incident=42';
    expect(mapStateQuery(parse(query))).toBe(query);
  });

  it('rounds coordinates to 5 decimals and wraps longitude', () => {
    const params = serializeMapState({ center: [52.123456789, 104.987654321 + 360], zoom: 7.6, overlays: [], base: 'dark', incident: null });
    expect(params.get('lat')).toBe('52.12346');
    expect(params.get('lng')).toBe('104.98765');
    expect(params.get('z')).toBe('8');
  });

  it('omits the default basemap and an empty selection, writes an empty layer list', () => {
    const params = serializeMapState({ center: [53.5, 108], zoom: 5, overlays: [], base: DEFAULT_BASE, incident: null });
    expect(params.has('base')).toBe(false);
    expect(params.has('incident')).toBe(false);
    expect(params.get('layers')).toBe('');
    expect(parseMapState(params).overlays).toEqual([]);
  });

  it('keeps unrelated params and replaces the old map keys', () => {
    const current = new URLSearchParams('utm_source=tg&lat=1&lng=2&z=3&incident=7&base=osm');
    const params = serializeMapState({ center: [10, 20], zoom: 6, overlays: ['oopt'], base: 'dark', incident: null }, current);
    expect(params.get('utm_source')).toBe('tg');
    expect(params.get('lat')).toBe('10.00000');
    expect(params.has('incident')).toBe(false);
    expect(params.has('base')).toBe(false);
    expect(current.get('lat')).toBe('1'); // input not mutated
  });

  it('builds a share link with readable commas', () => {
    const url = mapShareUrl('https://forestwatch.ru', '/', { center: [52.2851, 104.2834], zoom: 9, overlays: ['loss', 'incidents'], base: 'dark', incident: 42 });
    expect(url).toBe('https://forestwatch.ru/?lat=52.28510&lng=104.28340&z=9&layers=loss,incidents&incident=42');
  });
});

describe('map state: defaults and legacy links', () => {
  it('an empty URL gives the default view without a pin', () => {
    expect(parse('')).toEqual({
      center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, overlays: [...DEFAULT_OVERLAYS], base: DEFAULT_BASE,
      incident: null, hasCenter: false, showTarget: false,
    });
  });

  it('/?lat&lng&incident (old incident links) — zoom 12 and a pin, as before', () => {
    const state = parse('lat=52.2851&lng=104.2834&incident=42');
    expect(state).toMatchObject({ center: [52.2851, 104.2834], zoom: LEGACY_TARGET_ZOOM, incident: 42, showTarget: true, hasCenter: true });
    expect(state.overlays).toEqual([...DEFAULT_OVERLAYS]);
  });

  it('/?lat&lng (old point links) — zoom 12 and a pin', () => {
    expect(parse('lat=52.2851&lng=104.2834')).toMatchObject({ zoom: LEGACY_TARGET_ZOOM, incident: null, showTarget: true });
  });

  it('a new-style view without an incident has no pin', () => {
    expect(parse('lat=52.2851&lng=104.2834&z=8')).toMatchObject({ zoom: 8, showTarget: false });
  });

  it('a new-style view with an incident pins it until the incident layer finds it', () => {
    expect(parse('lat=52.2851&lng=104.2834&z=8&incident=5')).toMatchObject({ zoom: 8, incident: 5, showTarget: true });
  });

  it('an incident without a centre keeps the default view (the layer focuses it)', () => {
    expect(parse('incident=5')).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, incident: 5, hasCenter: false, showTarget: false });
  });

  it('Chukotka: negative longitudes are valid', () => {
    expect(parse('lat=66.3&lng=-172.5&z=6').center).toEqual([66.3, -172.5]);
  });
});

describe('map state: invalid values are ignored', () => {
  it.each([
    'lat=abc&lng=104',
    'lat=91&lng=104',
    'lat=52&lng=181',
    'lat=52',
    'lng=104',
    'lat=&lng=',
    'lat=1e1&lng=104',
    'lat=0x10&lng=104',
    'lat=Infinity&lng=104',
    'lat=52;DROP&lng=104',
  ])('%s → default centre, no pin', query => {
    expect(parse(query)).toMatchObject({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, hasCenter: false, showTarget: false });
  });

  it('a bad zoom falls back to the default, keeps the centre', () => {
    for (const z of ['0', '20', '-3', '7.5', 'abc', '']) {
      expect(parse(`lat=52&lng=104&z=${z}`)).toMatchObject({ center: [52, 104], zoom: DEFAULT_ZOOM });
    }
  });

  it('unknown layers are dropped; only-unknown lists fall back to the defaults', () => {
    expect(parse('layers=loss,evil,oopt,loss').overlays).toEqual(['loss', 'oopt']);
    expect(parse('layers=evil,<script>').overlays).toEqual([...DEFAULT_OVERLAYS]);
    expect(parse('layers=,,').overlays).toEqual([]);
  });

  it('an unknown basemap falls back to the default', () => {
    expect(parse('base=google').base).toBe(DEFAULT_BASE);
    expect(parse('base=satellite').base).toBe('satellite');
  });

  it('a bad incident id is ignored', () => {
    for (const id of ['0', '-1', 'abc', '1.5', '99999999999999999999', '1e3']) {
      expect(parse(`incident=${id}`).incident).toBeNull();
    }
  });
});

describe('map state: single parsers', () => {
  it('parseLat/parseLng accept plain decimals in range', () => {
    expect(parseLat('-90')).toBe(-90);
    expect(parseLat(' 52.5 ')).toBe(52.5);
    expect(parseLat('90.00001')).toBeNull();
    expect(parseLng('-180')).toBe(-180);
    expect(parseLng('180.1')).toBeNull();
    expect(parseLng(null)).toBeNull();
  });

  it('parseZoom accepts integers 1–19', () => {
    expect(parseZoom('1')).toBe(1);
    expect(parseZoom('19')).toBe(19);
    expect(parseZoom('0')).toBeNull();
    expect(parseZoom(null)).toBeNull();
  });

  it('parseIncident takes positive safe integers', () => {
    expect(parseIncident('42')).toBe(42);
    expect(parseIncident(null)).toBeNull();
  });

  it('parseBase and parseOverlays use fixed id lists', () => {
    for (const id of BASE_IDS) expect(parseBase(id)).toBe(id);
    expect(parseBase('DARK')).toBeNull();
    expect(parseOverlays(null)).toBeNull();
    expect(parseOverlays('incidents,loss')).toEqual(['loss', 'incidents']);
  });

  it('wrapLng / formatCoord', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(104.5)).toBe(104.5);
    expect(wrapLng(-360)).toBe(0);
    expect(formatCoord(-0.000001)).toBe('0.00000');
    expect(formatCoord(52.285)).toBe('52.28500');
  });

  it('sameMapState ignores sub-5-decimal jitter and layer order', () => {
    const a: MapState = { center: [52.2851, 104.2834], zoom: 9, overlays: ['loss', 'oopt'], base: 'dark', incident: null };
    expect(sameMapState(a, { ...a, center: [52.285100001, 104.283400001], overlays: ['oopt', 'loss'] })).toBe(true);
    expect(sameMapState(a, { ...a, zoom: 10 })).toBe(false);
    expect(sameMapState(a, { ...a, incident: 1 })).toBe(false);
    expect(sameMapState(a, { ...a, overlays: ['loss'] })).toBe(false);
  });
});

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls once with the last arguments after the delay', () => {
    const fn = jest.fn();
    const run = debounce(fn, 400);
    run(1);
    run(2);
    jest.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    run(3);
    jest.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('cancel() drops a pending call', () => {
    const fn = jest.fn();
    const run = debounce(fn, 400);
    run();
    run.cancel();
    jest.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
