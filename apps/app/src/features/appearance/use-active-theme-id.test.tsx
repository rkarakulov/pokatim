/// <reference types="jest" />
import type { AppThemeId, ProfileView } from '@pokatim/contracts';
import { focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { liveSession } from '@/__tests__/auth-fixtures';
import { createQueryWrapper } from '@/__tests__/query-wrapper';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { useActiveThemeId } from './use-active-theme-id';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const store = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const never = () => new Promise<never>(() => undefined);
const KEY = 'pokatim.appTheme';

const profile = (themeId: AppThemeId | 'unknown'): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId,
  avatarUploadBlockedUntil: null,
  showRouteRides: false,
});

const signIn = () => useSessionStore.setState({ status: 'signedIn', session: liveSession });
const signOut = () => useSessionStore.setState({ status: 'signedOut', session: null });

const render = () => renderHook(() => useActiveThemeId(), { wrapper: createQueryWrapper() });

afterEach(() => {
  jest.clearAllMocks();
  focusManager.setFocused(undefined);
});

describe('useActiveThemeId (native, user-theme A9)', () => {
  it('пока кэш читается — null (сплэш), даже если профиль уже пришёл', async () => {
    signIn();
    jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(never);
    getProfile.mockResolvedValue(profile('atlas'));
    const { result } = await render();
    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toBeNull();
  });

  it('сессия ещё неизвестна — тема из кэша, профиль не запрашивается', async () => {
    store.set(KEY, '"atlas"');
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('atlas'));
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('без кэша и без сессии — «Классика»', async () => {
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('classic'));
  });

  it('вошёл — тема профиля и запись в кэш', async () => {
    store.set(KEY, '"atlas"');
    signIn();
    getProfile.mockResolvedValue(profile('journal'));
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('journal'));
    await waitFor(() => expect(store.get(KEY)).toBe('"journal"'));
  });

  it('профиль с «Классикой» — кэш стирается', async () => {
    store.set(KEY, '"atlas"');
    signIn();
    getProfile.mockResolvedValue(profile('classic'));
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('classic'));
    await waitFor(() => expect(store.has(KEY)).toBe(false));
  });

  it("незнакомая тема профиля ('unknown') — «Классика»", async () => {
    store.set(KEY, '"atlas"');
    signIn();
    getProfile.mockResolvedValue(profile('unknown'));
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('classic'));
  });

  it('профиль в ошибке — последняя известная (кэш), кэш не трогается', async () => {
    store.set(KEY, '"planner"');
    signIn();
    getProfile.mockRejectedValue(new Error('network'));
    const { result } = await render();
    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe('planner'));
    expect(store.get(KEY)).toBe('"planner"');
  });

  it('запуск без сессии (signedOut) — «Классика», кэш стирается (RC-2)', async () => {
    store.set(KEY, '"atlas"');
    signOut();
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('classic'));
    await waitFor(() => expect(store.has(KEY)).toBe(false));
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('переход unknown → signedOut (refresh 401 на запуске) — «Классика» и стирание', async () => {
    store.set(KEY, '"atlas"');
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('atlas'));
    await act(async () => signOut());
    expect(result.current).toBe('classic');
    await waitFor(() => expect(store.has(KEY)).toBe(false));
  });

  it('выход или отзыв сессии сервером (signedIn → signedOut) — «Классика» и стирание', async () => {
    signIn();
    getProfile.mockResolvedValue(profile('chrono'));
    const { result } = await render();
    await waitFor(() => expect(result.current).toBe('chrono'));
    await waitFor(() => expect(store.get(KEY)).toBe('"chrono"'));

    await act(async () => signOut());
    expect(result.current).toBe('classic');
    await waitFor(() => expect(store.has(KEY)).toBe(false));
  });

  it('возврат в приложение (фокус) перезапрашивает профиль: тема с другого устройства', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00Z') });
    try {
      signIn();
      getProfile.mockResolvedValueOnce(profile('classic'));
      const { result } = await render();
      await waitFor(() => expect(result.current).toBe('classic'));

      getProfile.mockResolvedValueOnce(profile('navigation'));
      await act(async () => {
        jest.advanceTimersByTime(11_000);
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(result.current).toBe('navigation'));
      expect(getProfile).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
