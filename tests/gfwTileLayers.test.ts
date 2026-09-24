import { gfwUpstreamUrl, parseTileRequest } from '../backend/services/gfwTileLayers';

describe('parseTileRequest', () => {
  it('accepts a known layer with in-range integer coordinates', () => {
    expect(parseTileRequest('loss', '8', '204', '82')).toMatchObject({ layer: 'loss', z: 8, x: 204, y: 82 });
  });

  it('rejects unknown layers, including prototype keys', () => {
    expect(parseTileRequest('evil', '1', '0', '0')).toBeNull();
    expect(parseTileRequest('__proto__', '1', '0', '0')).toBeNull();
    expect(parseTileRequest('constructor', '1', '0', '0')).toBeNull();
  });

  it('rejects non-integer, negative and out-of-range coordinates', () => {
    expect(parseTileRequest('loss', '8.5', '1', '1')).toBeNull();
    expect(parseTileRequest('loss', '8', '-1', '1')).toBeNull();
    expect(parseTileRequest('loss', '8', '256', '1')).toBeNull();
    expect(parseTileRequest('loss', '8', '1', '../1')).toBeNull();
  });

  it('rejects zooms beyond the layer maximum', () => {
    expect(parseTileRequest('cover', '13', '0', '0')).toBeNull();
    expect(parseTileRequest('loss', '14', '0', '0')).toBeNull();
  });
});

describe('gfwUpstreamUrl', () => {
  it('builds dynamic loss and dated DIST-ALERT URLs', () => {
    expect(gfwUpstreamUrl({ layer: 'loss', z: 8, x: 204, y: 82 }, 'v20260919'))
      .toBe('https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.13/dynamic/8/204/82.png?implementation=tcd_30');
    expect(gfwUpstreamUrl({ layer: 'dist', z: 5, x: 25, y: 10 }, 'v20260919'))
      .toBe('https://tiles.globalforestwatch.org/umd_glad_dist_alerts/v20260919/dynamic/5/25/10.png?implementation=default');
  });
});
