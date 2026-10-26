/// <reference types="jest" />
import { mapStyleUrl } from './map-style';

const LIGHT = 'https://tiles.example/styles/positron';
const DARK = 'https://tiles.example/styles/dark';

describe('mapStyleUrl (ADR-0014: URL стиля только из env)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  });

  it('env задан — светлая и тёмная по теме', () => {
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = DARK;
    expect(mapStyleUrl(false)).toBe(LIGHT);
    expect(mapStyleUrl(true)).toBe(DARK);
  });

  it('не задан или пустая строка — карты нет', () => {
    expect(mapStyleUrl(false)).toBeNull();
    expect(mapStyleUrl(true)).toBeNull();
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = '';
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
    expect(mapStyleUrl(false)).toBeNull();
    expect(mapStyleUrl(true)).toBe(LIGHT);
  });
});
