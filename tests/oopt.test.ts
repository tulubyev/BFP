import {
  describeOopt,
  ooptColor,
  ooptKind,
  ooptMarkerVisible,
  ooptStyle,
  withAlpha,
  type OoptProps,
} from '../frontend/src/map/oopt';

const reserve: OoptProps = {
  id: 1,
  name: 'Байкальский заповедник',
  name_ru: 'Байкальский заповедник',
  protect_class: '1',
  boundary: 'protected_area',
  lat: 51.5,
  lon: 105.0,
  wikidata: null,
  website: 'https://example.org',
  area_ha: 165724,
  osm_url: 'https://www.openstreetmap.org/relation/1',
};

const park: OoptProps = { ...reserve, id: 2, boundary: 'national_park', protect_class: '2' };

describe('ooptKind / ooptColor', () => {
  it('classifies by the boundary tag', () => {
    expect(ooptKind(reserve)).toBe('strict_reserve');
    expect(ooptKind(park)).toBe('national_park');
  });

  it('gives each kind a distinct color', () => {
    expect(ooptColor('strict_reserve')).not.toBe(ooptColor('national_park'));
  });
});

describe('ooptStyle', () => {
  it('fills and strokes with the kind color', () => {
    const style = ooptStyle(reserve);
    expect(style.color).toBe(ooptColor('strict_reserve'));
    expect(style.fillColor).toBe(style.color);
    expect(style.fill).toBe(true);
    expect(style.fillOpacity).toBeGreaterThan(0);
  });
});

describe('ooptMarkerVisible', () => {
  it('shows the label marker only below the polygon-legibility threshold', () => {
    expect(ooptMarkerVisible(5)).toBe(true);
    expect(ooptMarkerVisible(6)).toBe(false);
    expect(ooptMarkerVisible(10)).toBe(false);
  });
});

describe('withAlpha', () => {
  it('converts a hex color to an rgba() string', () => {
    expect(withAlpha('#10b981', 0.35)).toBe('rgba(16,185,129,0.35)');
    expect(withAlpha('#8b5cf6', 0.5)).toBe('rgba(139,92,246,0.5)');
  });
});

describe('describeOopt', () => {
  it('labels a strict reserve with its IUCN class and formatted area', () => {
    const d = describeOopt(reserve);
    expect(d.title).toBe('Байкальский заповедник');
    expect(d.typeLabel).toContain('Заповедник');
    expect(d.classLabel).toBe('Ia/Ib (строго охраняемый)');
    expect(d.areaText).toBe(`${(165724).toLocaleString('ru-RU')} га`);
  });

  it('labels a national park and omits area when absent', () => {
    const d = describeOopt({ ...park, area_ha: null });
    expect(d.typeLabel).toContain('Национальный парк');
    expect(d.classLabel).toBe('II (нацпарк)');
    expect(d.areaText).toBeNull();
  });
});
