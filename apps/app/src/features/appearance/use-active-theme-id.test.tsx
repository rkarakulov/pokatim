/// <reference types="jest" />
import { focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { createQueryWrapper } from '@/__tests__/query-wrapper';
import { api } from '@/lib/api';

import { useActiveThemeId } from './use-active-theme-id';

jest.mock('@/lib/api');

const getAppearance = jest.mocked(api.getAppearance);
const store = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const never = () => new Promise<never>(() => undefined);

afterEach(() => {
  store.clear();
  jest.clearAllMocks();
  focusManager.setFocused(undefined);
});

describe('useActiveThemeId (native)', () => {
  it('пока кэш читается — null (сплэш); кэш — тема до ответа сервера', async () => {
    store.set('pokatim.appTheme', '"atlas"');
    getAppearance.mockImplementation(never);
    const { result } = await renderHook(() => useActiveThemeId(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current).toBe('atlas'));
  });

  it('кэш ещё не прочитан — null, даже если сервер ответил', async () => {
    jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(never);
    getAppearance.mockResolvedValue({ themeId: 'atlas' });
    const { result } = await renderHook(() => useActiveThemeId(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  it('ответ сервера отличается от кэша — смена темы и запись в кэш', async () => {
    store.set('pokatim.appTheme', '"atlas"');
    getAppearance.mockResolvedValue({ themeId: 'journal' });
    const { result } = await renderHook(() => useActiveThemeId(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current).toBe('journal'));
    await waitFor(() => expect(store.get('pokatim.appTheme')).toBe('"journal"'));
  });

  it('ответ совпадает с кэшем — без записи', async () => {
    store.set('pokatim.appTheme', '"atlas"');
    getAppearance.mockResolvedValue({ themeId: 'atlas' });
    const { result } = await renderHook(() => useActiveThemeId(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current).toBe('atlas'));
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('ошибка запроса — тема из кэша; без кэша — «Классика»', async () => {
    store.set('pokatim.appTheme', '"planner"');
    getAppearance.mockRejectedValue(new Error('network'));
    const cached = await renderHook(() => useActiveThemeId(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    await waitFor(() => expect(cached.result.current).toBe('planner'));

    store.clear();
    const empty = await renderHook(() => useActiveThemeId(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(empty.result.current).toBe('classic'));
  });

  it("незнакомая тема сервера ('unknown') — «Классика»", async () => {
    store.set('pokatim.appTheme', '"atlas"');
    getAppearance.mockResolvedValue({ themeId: 'unknown' });
    const { result } = await renderHook(() => useActiveThemeId(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current).toBe('classic'));
  });

  it('возврат в приложение (фокус) перезапрашивает тему, когда данные устарели', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z') });
    try {
      getAppearance.mockResolvedValueOnce({ themeId: 'classic' });
      const { result } = await renderHook(() => useActiveThemeId(), {
        wrapper: createQueryWrapper(),
      });
      await waitFor(() => expect(result.current).toBe('classic'));

      getAppearance.mockResolvedValueOnce({ themeId: 'navigation' });
      await act(async () => {
        jest.advanceTimersByTime(11_000);
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(result.current).toBe('navigation'));
      expect(getAppearance).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
