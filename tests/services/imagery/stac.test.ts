import {
  HttpStatusError, S2_COLLECTION, bucketItemUrl, createStacClient, parseEpsg, platformLabel, searchBody, slimItem,
} from '../../../backend/services/imagery/stac';

const ID = 'S2A_T48UUE_20240714T043045_L2A';
const asset = (name: string, extra: object = {}) => ({ href: `https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/x/${name}.tif`, ...extra });

const rawItem = (overrides: any = {}) => ({
  id: ID,
  collection: S2_COLLECTION,
  bbox: [101.94, 53.12, 103.52, 54.14],
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { datetime: '2024-07-14T04:33:25.472Z', platform: 'sentinel-2a', 'eo:cloud_cover': 6.32, 'proj:epsg': 32648, ...overrides.properties },
  assets: {
    visual: asset('TCI'),
    red: asset('B04', { 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] }),
    nir08: asset('B8A'),
    swir22: asset('B12'),
    scl: asset('SCL'),
    thumbnail: asset('thumb'),
    ...overrides.assets,
  },
});

describe('parseEpsg', () => {
  it('reads proj:code and proj:epsg', () => {
    expect(parseEpsg('EPSG:32648', undefined)).toBe(32648);
    expect(parseEpsg(undefined, 32648)).toBe(32648);
    expect(parseEpsg('EPSG:32648', 1)).toBe(32648);
    expect(parseEpsg('OGC:CRS84', null)).toBeNull();
    expect(parseEpsg(undefined, undefined)).toBeNull();
  });
});

describe('slimItem', () => {
  it('keeps only what the renders need', () => {
    const s = slimItem(rawItem());
    expect(s).toEqual({
      id: ID,
      bbox: [101.94, 53.12, 103.52, 54.14],
      datetime: '2024-07-14T04:33:25.472Z',
      platform: 'sentinel-2a',
      cloudCover: 6.32,
      epsg: 32648,
      assets: {
        visual: asset('TCI'),
        red: asset('B04', { 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] }),
        nir08: asset('B8A'),
        swir22: asset('B12'),
        scl: asset('SCL'),
      },
    });
  });

  it('takes the EPSG code from proj:code or an asset when the item has no proj:epsg', () => {
    expect(slimItem(rawItem({ properties: { 'proj:epsg': undefined, 'proj:code': 'EPSG:32647' } }))?.epsg).toBe(32647);
    expect(slimItem(rawItem({ properties: { 'proj:epsg': undefined }, assets: { scl: asset('SCL', { 'proj:code': 'EPSG:32649' }) } }))?.epsg).toBe(32649);
  });

  it('drops non-https hrefs (s3:// alternates are not fetchable over HTTP)', () => {
    expect(slimItem(rawItem({ assets: { visual: { href: 's3://bucket/TCI.tif' } } }))?.assets.visual).toBeUndefined();
  });

  it.each([
    ['no id', { id: undefined }],
    ['a foreign id', { id: 'LC08_L2SP_123' }],
    ['no bbox', { bbox: undefined }],
    ['no datetime', { properties: { datetime: null } }],
  ])('rejects an item with %s', (_label, patch: any) => {
    const raw = rawItem({ properties: patch.properties });
    Object.assign(raw, 'id' in patch ? { id: patch.id } : {}, 'bbox' in patch ? { bbox: patch.bbox } : {});
    expect(slimItem(raw)).toBeNull();
  });

  it('rejects an item without any EPSG code', () => {
    expect(slimItem(rawItem({ properties: { 'proj:epsg': undefined } }))).toBeNull();
  });
});

describe('platformLabel', () => {
  it('formats the platform, falling back to the id', () => {
    expect(platformLabel({ id: ID, platform: 'sentinel-2a' })).toBe('Sentinel-2A');
    expect(platformLabel({ id: 'S2C_T48UUE_20250714T043045_L2A', platform: null })).toBe('Sentinel-2C');
    expect(platformLabel({ id: 'S2B_T48UUE_20250714T043045_L2A', platform: 'Sentinel-2B' })).toBe('Sentinel-2B');
  });
});

describe('bucketItemUrl', () => {
  it('builds the bucket path without zero padding (as the bucket stores it)', () => {
    expect(bucketItemUrl(ID)).toBe(`https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/48/U/UE/2024/7/${ID}/${ID}.json`);
    expect(bucketItemUrl('S2B_T05VNK_20251203T220000_L2A')).toContain('/sentinel-2-c1-l2a/5/V/NK/2025/12/');
    expect(bucketItemUrl('bad')).toBeNull();
  });
});

describe('searchBody', () => {
  it('asks for the collection, bbox, interval, cloud filter and sort', () => {
    expect(searchBody({ bbox: [1, 2, 3, 4], datetime: 'a/b', sort: 'desc', limit: 6, maxCloudCover: 80 })).toEqual({
      collections: ['sentinel-2-c1-l2a'],
      bbox: [1, 2, 3, 4],
      datetime: 'a/b',
      query: { 'eo:cloud_cover': { lt: 80 } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      limit: 6,
    });
  });
});

describe('createStacClient', () => {
  it('search posts to /search and slims the features', async () => {
    const fetchJson = jest.fn(async () => ({ features: [rawItem(), { id: 'junk' }] }));
    const client = createStacClient(fetchJson, 'https://stac.test/v1');
    const found = await client.search({ bbox: [1, 2, 3, 4], datetime: 'a/b', sort: 'asc', limit: 6, maxCloudCover: 80 });
    expect(found.map(s => s.id)).toEqual([ID]);
    expect(fetchJson).toHaveBeenCalledWith('https://stac.test/v1/search', expect.objectContaining({ method: 'POST' }));
  });

  it('search fails loudly on a malformed answer (never "no scenes")', async () => {
    const client = createStacClient(async () => ({ type: 'error' }));
    await expect(client.search({ bbox: [1, 2, 3, 4], datetime: 'a/b', sort: 'asc', limit: 6, maxCloudCover: 80 })).rejects.toThrow();
  });

  it('getItem: 404 from the catalogue means no such scene', async () => {
    const client = createStacClient(async url => { throw new HttpStatusError(404, url); });
    await expect(client.getItem(ID)).resolves.toBeNull();
  });

  it('getItem falls back to the bucket copy when the catalogue is down', async () => {
    const urls: string[] = [];
    const client = createStacClient(async url => {
      urls.push(url);
      if (url.startsWith('https://stac.test')) throw new HttpStatusError(503, url);
      return rawItem();
    }, 'https://stac.test/v1');
    expect((await client.getItem(ID))?.id).toBe(ID);
    expect(urls).toEqual([`https://stac.test/v1/collections/sentinel-2-c1-l2a/items/${ID}`, bucketItemUrl(ID)]);
  });

  it('getItem rethrows the catalogue error when the bucket copy also fails', async () => {
    const client = createStacClient(async url => {
      if (url.includes('amazonaws')) throw new Error('bucket unreachable');
      throw new HttpStatusError(502, url);
    });
    await expect(client.getItem(ID)).rejects.toThrow('HTTP 502');
  });
});
