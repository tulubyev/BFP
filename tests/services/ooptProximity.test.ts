import {
  MAX_DISTANCE_KM, OOPT_NOTE, distanceToBoundaryKm, lonDelta, ooptProximity, ooptRelation,
} from '../../backend/services/ooptProximity';
import type { OOPTFeature } from '../../backend/services/overpassService';

/** Square polygon feature, `half` degrees around (lat, lon). */
function square(id: number, name: string, lat: number, lon: number, half: number, area_ha: number | null = null): OOPTFeature {
  const ring = [
    [lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half],
  ];
  return {
    id, name, name_ru: name, protect_class: '2', boundary: 'national_park', lat, lon, wikidata: null, website: null,
    area_ha, osm_url: `https://www.openstreetmap.org/relation/${id}`, geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

const KM_PER_DEG = (Math.PI / 180) * 6371;

describe('distanceToBoundaryKm', () => {
  it('measures to the nearest edge, not to a vertex', () => {
    // Edge at lon 105.0, point 0.1° of longitude east of it at lat 52
    const f = square(1, 'A', 52, 104.5, 0.5);
    const km = distanceToBoundaryKm({ lat: 52, lon: 105.1 }, f.geometry);
    expect(km).toBeCloseTo(0.1 * KM_PER_DEG * Math.cos((52 * Math.PI) / 180), 1);
  });

  it('measures north-south distances in km of latitude', () => {
    const f = square(1, 'A', 52, 104.5, 0.5);
    expect(distanceToBoundaryKm({ lat: 52.7, lon: 104.5 }, f.geometry)).toBeCloseTo(0.2 * KM_PER_DEG, 1);
  });

  it('handles degraded Point geometries and multipolygons', () => {
    const point = { type: 'Point' as const, coordinates: [104.5, 52.1] };
    expect(distanceToBoundaryKm({ lat: 52, lon: 104.5 }, point)).toBeCloseTo(0.1 * KM_PER_DEG, 1);
    const a = square(1, 'A', 52, 100, 0.5).geometry as GeoJSON.Polygon;
    const b = square(2, 'B', 52, 105, 0.5).geometry as GeoJSON.Polygon;
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [a.coordinates, b.coordinates] };
    expect(distanceToBoundaryKm({ lat: 53, lon: 105 }, multi)).toBeCloseTo(0.5 * KM_PER_DEG, 1);
  });

  it('works across the antimeridian (Chukotka)', () => {
    expect(lonDelta(-179.9, 179.9)).toBeCloseTo(0.2, 6);
    expect(lonDelta(179.9, -179.9)).toBeCloseTo(-0.2, 6);
    const f = square(1, 'Чукотка', 66, 179.5, 0.4);
    // Point just across 180°: the east edge at 179.9 is ~0.2° of longitude away
    const km = distanceToBoundaryKm({ lat: 66, lon: -179.9 }, f.geometry);
    expect(km).toBeCloseTo(0.2 * KM_PER_DEG * Math.cos((66 * Math.PI) / 180), 0);
    expect(ooptRelation({ lat: 66, lon: -179.9 }, [f]).relation).toBe('near');
  });
});

describe('ooptRelation', () => {
  const baikal = square(1, 'Прибайкальский', 52.5, 106, 0.5, 400_000);
  const zapovednik = square(2, 'Байкало-Ленский', 52.5, 106.2, 0.1, 20_000);
  const far = square(3, 'Далёкий', 60, 130, 0.5);

  it('says inside and prefers the smallest of overlapping areas', () => {
    expect(ooptRelation({ lat: 52.5, lon: 105.8 }, [baikal, far])).toMatchObject({ relation: 'inside', name: 'Прибайкальский', id: 1 });
    expect(ooptRelation({ lat: 52.5, lon: 106.2 }, [baikal, zapovednik])).toMatchObject({ relation: 'inside', name: 'Байкало-Ленский' });
  });

  it('gives the nearest boundary within 50 km, rounded to 0.1 km', () => {
    const r = ooptRelation({ lat: 52.5, lon: 106.8 }, [baikal, far]);
    expect(r.relation).toBe('near');
    if (r.relation !== 'near') return;
    expect(r.name).toBe('Прибайкальский');
    expect(r.osm_url).toBe('https://www.openstreetmap.org/relation/1');
    expect(r.distance_km).toBeCloseTo(0.3 * KM_PER_DEG * Math.cos((52.5 * Math.PI) / 180), 0);
    expect(Math.round(r.distance_km * 10) / 10).toBe(r.distance_km);
  });

  it('picks the closer of two areas', () => {
    const east = square(4, 'Восточный', 52.5, 107.2, 0.1);
    const r = ooptRelation({ lat: 52.5, lon: 107.0 }, [baikal, east]);
    expect(r).toMatchObject({ relation: 'near', name: 'Восточный' });
  });

  it('says none beyond 50 km (and with no data at all)', () => {
    expect(ooptRelation({ lat: 55, lon: 110 }, [baikal, far])).toEqual({ relation: 'none', radius_km: MAX_DISTANCE_KM });
    expect(ooptRelation({ lat: 55, lon: 110 }, [])).toEqual({ relation: 'none', radius_km: 50 });
    // just under / over the limit along a meridian
    const edgeLat = 53.0;
    const under = ooptRelation({ lat: edgeLat + 49.5 / KM_PER_DEG, lon: 106 }, [baikal]);
    const over = ooptRelation({ lat: edgeLat + 50.5 / KM_PER_DEG, lon: 106 }, [baikal]);
    expect(under.relation).toBe('near');
    expect(over.relation).toBe('none');
  });

  it('never says inside for a Point-only (degraded) area', () => {
    const pointOnly: OOPTFeature = { ...baikal, id: 9, geometry: { type: 'Point', coordinates: [106, 52.5] } };
    expect(ooptRelation({ lat: 52.5, lon: 106 }, [pointOnly])).toMatchObject({ relation: 'near', distance_km: 0 });
  });
});

describe('ooptProximity', () => {
  it('carries the OOPT data date, the approximate-borders note and the source', () => {
    const result = ooptProximity({ lat: 55, lon: 110 }, { features: [], fetchedAt: '2026-09-26T03:00:00.000Z' });
    expect(result).toEqual({
      result: { relation: 'none', radius_km: 50 },
      data_date: '2026-09-26T03:00:00.000Z',
      note: OOPT_NOTE,
      source: expect.stringContaining('OpenStreetMap'),
      point: 'center',
    });
    expect(OOPT_NOTE).toBe('по границам OSM, приблизительно');
  });
});
