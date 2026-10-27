/// <reference types="jest" />
import { fetchPublicForSsr } from '@/lib/public-ssr';

import { refreshSsrTheme, ssrThemeId } from './ssr-theme';

jest.mock('@/lib/public-ssr', () => ({ fetchPublicForSsr: jest.fn() }));

const fetchTheme = jest.mocked(fetchPublicForSsr);
const KEY = Symbol.for('pokatim.appTheme');
const holder = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete holder[KEY];
  fetchTheme.mockReset();
});

describe('тема процесса SSR', () => {
  it('ещё не узнавали — «Классика»', () => {
    expect(ssrThemeId()).toBe('classic');
  });

  it('ответ API — новая тема процесса; хранится в globalThis под Symbol.for (общая для бандлов)', async () => {
    fetchTheme.mockResolvedValue({ status: 'found', data: { themeId: 'atlas' } });
    await refreshSsrTheme();
    expect(fetchTheme).toHaveBeenCalledWith('/v1/appearance', expect.anything());
    expect(ssrThemeId()).toBe('atlas');
    expect(holder[KEY]).toBe('atlas');
  });

  it('API недоступен — последняя известная', async () => {
    fetchTheme.mockResolvedValueOnce({ status: 'found', data: { themeId: 'chrono' } });
    await refreshSsrTheme();
    fetchTheme.mockResolvedValueOnce({ status: 'unavailable' });
    await refreshSsrTheme();
    expect(ssrThemeId()).toBe('chrono');
  });

  it("незнакомая тема ('unknown') — «Классика»", async () => {
    holder[KEY] = 'atlas';
    fetchTheme.mockResolvedValue({ status: 'found', data: { themeId: 'unknown' } });
    await refreshSsrTheme();
    expect(ssrThemeId()).toBe('classic');
  });
});
