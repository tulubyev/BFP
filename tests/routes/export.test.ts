import express from 'express';
import type { AddressInfo } from 'net';
import { createExportRouter, type ExportDeps } from '../../backend/routes/export';
import { INCIDENT_METHOD } from '../../backend/services/firmsHistory/incidents';

async function withServer(deps: Partial<ExportDeps>, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use('/api/export', createExportRouter({
    pool: { query: async () => ({ rows: [] }) },
    regions: { list: async () => { throw new Error('not used'); } },
    readJournal: async () => [],
    archiveCellsVersion: () => 2024,
    now: () => new Date('2026-09-27T12:00:00.000Z'),
    ...deps,
  }));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/export`);
  } finally {
    server.close();
  }
}

const incident = (id: number) => ({
  id, change_type: 'fire', detected_date: '2026-09-26', area_ha: '14.06', source: 'firms', satellite: 'N20',
  center_lat: '52.1', center_lng: '104.2', bbox_min_lat: '52.0', bbox_min_lng: '104.1', bbox_max_lat: '52.2', bbox_max_lng: '104.3',
  region: 'Иркутская область', metadata: { method: INCIDENT_METHOD, status: 'active', hotspot_count: 2 },
});

/** Fake pool: data query → `rows`, count query → `total`; records every call. */
function fakePool(rows: any[], total = rows.length) {
  const calls: { text: string; params?: any[] }[] = [];
  return {
    calls,
    async query(text: string, params?: any[]) {
      calls.push({ text, params });
      return text.startsWith('SELECT COUNT') ? { rows: [{ count: total }] } : { rows };
    },
  };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /api/export/incidents.*', () => {
  it('CSV: attachment with BOM, provenance header and one line per incident', async () => {
    await withServer({ pool: fakePool([incident(1), incident(2)]) }, async base => {
      const res = await fetch(`${base}/incidents.csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="forestwatch-incidents-2026-09-27.csv"');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = bytes.toString('utf8').slice(1).trimEnd().split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[0].startsWith('id,change_type,status,region')).toBe(true);
      const meta = JSON.parse(res.headers.get('x-export-metadata') as string);
      expect(meta).toMatchObject({
        dataset: 'incidents', generatedAt: '2026-09-27T12:00:00.000Z', count: 2,
        filters: { static_sources: 'exclude', sort: 'date_desc' }, methodology: 'https://forestwatch.ru/methodology',
      });
      expect(meta.warnings[0]).toContain('кластеры термоточек, не подтверждённые пожары');
      expect(meta.methods.staticMask.archiveCellsVersion).toBe(2024);
      expect(meta.sources.map((s: any) => s.id)).toEqual(['firms', 'osm_boundaries', 'postgis']);
    });
  });

  it('passes the feed filters into the query', async () => {
    const pool = fakePool([incident(1)]);
    await withServer({ pool }, async base => {
      const res = await fetch(`${base}/incidents.json?change_type=fire&region=${encodeURIComponent('Республика Бурятия')}&start_date=2026-09-01&end_date=2026-09-30&sort=date_asc&static_sources=only&limit=2&offset=40`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.metadata.filters).toEqual({
        static_sources: 'only', change_type: 'fire', region: 'Республика Бурятия', start_date: '2026-09-01', end_date: '2026-09-30', sort: 'date_asc',
      });
      expect(body.data).toHaveLength(1);
    });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].params).toEqual(['fire', 'Республика Бурятия', '2026-09-01', '2026-09-30', 5001]);
    expect(pool.calls[0].text).toContain("fc.metadata->>'status' = 'static_source'");
    expect(pool.calls[0].text).toContain('ORDER BY fc.detected_date ASC');
  });

  it('GeoJSON: FeatureCollection with metadata and bbox polygons', async () => {
    await withServer({ pool: fakePool([incident(7)]) }, async base => {
      const res = await fetch(`${base}/incidents.geojson`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/geo+json; charset=utf-8');
      expect(res.headers.get('content-disposition')).toContain('forestwatch-incidents-2026-09-27.geojson');
      const body = await res.json();
      expect(body.type).toBe('FeatureCollection');
      expect(body.metadata.count).toBe(1);
      expect(body.features[0].geometry.type).toBe('Polygon');
      expect(body.features[0].properties.url).toBe('https://forestwatch.ru/?lat=52.1&lng=104.2&incident=7');
    });
  });

  it('answers 413 above the limit instead of a truncated file', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => incident(i));
    await withServer({ pool: fakePool(rows, 12345) }, async base => {
      const res = await fetch(`${base}/incidents.csv`);
      expect(res.status).toBe(413);
      expect(res.headers.get('content-disposition')).toBeNull();
      const body = await res.json();
      expect(body).toMatchObject({ success: false, total: 12345, limit: 5000 });
      expect(body.error).toContain('Сузьте фильтры');
    });
  });

  it('exports exactly 5000 rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => incident(i));
    await withServer({ pool: fakePool(rows) }, async base => {
      const res = await fetch(`${base}/incidents.json`);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(5000);
    });
  });

  it('answers 503 with a message — not an empty file — when the database is down', async () => {
    const pool = { query: async () => { throw new Error('ECONNREFUSED'); } };
    await withServer({ pool }, async base => {
      for (const ext of ['csv', 'json', 'geojson']) {
        const res = await fetch(`${base}/incidents.${ext}`);
        expect(res.status).toBe(503);
        expect(res.headers.get('content-disposition')).toBeNull();
        expect((await res.json()).error).toContain('База данных недоступна');
      }
    });
  });

  it('still exports when the journal or the archive cell list are unavailable', async () => {
    await withServer({
      pool: fakePool([incident(1)]),
      readJournal: async () => { throw new Error('redis down'); },
      archiveCellsVersion: () => { throw new Error('bad file'); },
    }, async base => {
      const res = await fetch(`${base}/incidents.json`);
      expect(res.status).toBe(200);
      const { metadata } = await res.json();
      expect(metadata.sources[0].lastSuccessfulLoad).toBeNull();
      expect(metadata.methods.staticMask.archiveCellsVersion).toBeNull();
    });
  });

  it('404 for an unknown format', async () => {
    await withServer({}, async base => {
      expect((await fetch(`${base}/incidents.xlsx`)).status).toBe(404);
      expect((await fetch(`${base}/regions.geojson`)).status).toBe(404);
    });
  });
});

const regionsList = () => ({
  generatedAt: '2026-09-27T06:00:00.000Z',
  boundariesFile: 'ru-regions.2026-09.geojson',
  archive: null,
  regions: [{
    iso: 'RU-IRK', name: 'Иркутская область', areaKm2: 774846, baikal: true,
    indicators: [
      { id: 'hotspots_vegetation', label: 'Термоточки', value: null, unit: 'шт.', period: null, source: 'NASA FIRMS', kind: 'satellite' as const, definition: 'd', reason: 'архив FIRMS ещё не собран' },
      { id: 'woodiness', label: 'Лесистость', value: 83.1, unit: '%', period: '2024', source: 'Рослесхоз', kind: 'official' as const, definition: 'd' },
    ],
  }],
  diagnostics: { unmappedRosleshozNames: [], sourceErrors: [] },
});

describe('GET /api/export/regions.*', () => {
  it('CSV in long format, empty cell for a missing value', async () => {
    await withServer({ regions: { list: async () => regionsList() } }, async base => {
      const res = await fetch(`${base}/regions.csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="forestwatch-regions-2026-09-27.csv"');
      const text = (await res.text()).replace(/^﻿/, '');
      const lines = text.trimEnd().split('\r\n');
      expect(lines).toEqual([
        'iso,name,baikal,indicator_id,label,value,unit,period,kind,approximate,source,reason',
        'RU-IRK,Иркутская область,true,hotspots_vegetation,Термоточки,,шт.,,satellite,false,NASA FIRMS,архив FIRMS ещё не собран',
        'RU-IRK,Иркутская область,true,woodiness,Лесистость,83.1,%,2024,official,false,Рослесхоз,',
      ]);
      const meta = JSON.parse(res.headers.get('x-export-metadata') as string);
      expect(meta).toMatchObject({ dataset: 'regions', files: { boundaries: 'ru-regions.2026-09.geojson', firmsArchive: null } });
    });
  });

  it('JSON keeps null (never 0) and carries metadata with sources', async () => {
    await withServer({ regions: { list: async () => regionsList() } }, async base => {
      const res = await fetch(`${base}/regions.json`);
      const body = await res.json();
      expect(body.data[0].value).toBeNull();
      expect(body.metadata.sources.map((s: any) => s.id)).toEqual(['rosleshoz', 'firms', 'oopt', 'gfw_loss', 'osm_boundaries', 'postgis']);
      expect(body.metadata.sources.find((s: any) => s.id === 'osm_boundaries').version).toBe('ru-regions.2026-09.geojson');
    });
  });

  it('503 when the regional service fails or returns nothing', async () => {
    await withServer({ regions: { list: async () => { throw new Error('boom'); } } }, async base => {
      const res = await fetch(`${base}/regions.csv`);
      expect(res.status).toBe(503);
      expect(res.headers.get('content-disposition')).toBeNull();
    });
    await withServer({ regions: { list: async () => ({ ...regionsList(), regions: [] }) } }, async base => {
      expect((await fetch(`${base}/regions.json`)).status).toBe(503);
    });
  });
});
