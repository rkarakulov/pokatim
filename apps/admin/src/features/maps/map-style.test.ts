import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapStyleUrl } from './map-style';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mapStyleUrl (routes-05, RC-9)', () => {
  it('URL из VITE_MAP_STYLE_LIGHT; пусто — null', () => {
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', 'https://tiles.example/styles/positron');
    expect(mapStyleUrl()).toBe('https://tiles.example/styles/positron');
    vi.stubEnv('VITE_MAP_STYLE_LIGHT', '');
    expect(mapStyleUrl()).toBeNull();
  });
});
