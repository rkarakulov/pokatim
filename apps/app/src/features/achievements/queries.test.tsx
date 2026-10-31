/// <reference types="jest" />
import type { AchievementList } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { liveSession } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { ACHIEVEMENTS_KEY, useMarkAchievementsSeen } from './queries';

jest.mock('@/lib/api');

afterEach(() => jest.clearAllMocks());

const list: AchievementList = {
  items: [
    {
      code: 'races_5',
      object: { kind: 'race', id: '0190a6f4-0000-7000-8000-000000000201', title: 'Гонка' },
      factDate: '2026-05-02',
      level: 'silver',
      seen: false,
    },
  ],
  progress: [{ code: 'races_5', level: 'gold', current: 15, target: 30 }],
};

function setup() {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ACHIEVEMENTS_KEY, list);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useMarkAchievementsSeen — оптимистичная пометка (RC-L3)', () => {
  it('seen: true в кэше, прогресс сохраняется', async () => {
    jest.mocked(api.markAchievementsSeen).mockResolvedValue(undefined);
    const { client, wrapper } = setup();
    const { result } = await renderHook(() => useMarkAchievementsSeen(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync([{ code: 'races_5', seasonId: null }]);
    });
    expect(api.markAchievementsSeen).toHaveBeenCalledWith(expect.any(String), ['races_5'], []);
    expect(client.getQueryData(ACHIEVEMENTS_KEY)).toEqual({
      items: [{ ...list.items[0], seen: true }],
      progress: list.progress,
    });
  });

  it('ошибка — откат seen, прогресс сохраняется', async () => {
    jest.mocked(api.markAchievementsSeen).mockRejectedValue(new Error('offline'));
    const { client, wrapper } = setup();
    const { result } = await renderHook(() => useMarkAchievementsSeen(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync([{ code: 'races_5', seasonId: null }])
        .catch(() => undefined);
    });
    expect(client.getQueryData(ACHIEVEMENTS_KEY)).toEqual(list);
  });
});

describe('useMarkAchievementsSeen — сезонные по адресу (achievements-seasonal)', () => {
  const A = '0190a6f4-0000-7000-8000-000000000401';
  const B = '0190a6f4-0000-7000-8000-000000000402';
  const season = (seasonId: string) => ({
    code: 'season_podium' as const,
    object: { kind: 'season' as const, id: seasonId, title: 'Сезон' },
    factDate: '2025-10-31',
    level: null,
    seen: false,
  });

  it('помечает только свой сезон; запрос — `seasonal` с сезоном; прогресс сохраняется', async () => {
    jest.mocked(api.markAchievementsSeen).mockResolvedValue(undefined);
    const { client, wrapper } = setup();
    client.setQueryData(ACHIEVEMENTS_KEY, { ...list, items: [season(A), season(B)] });
    const { result } = await renderHook(() => useMarkAchievementsSeen(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync([{ code: 'season_podium', seasonId: A }]);
    });
    expect(api.markAchievementsSeen).toHaveBeenCalledWith(
      expect.any(String),
      [],
      [{ code: 'season_podium', seasonId: A }],
    );
    expect(client.getQueryData(ACHIEVEMENTS_KEY)).toEqual({
      items: [{ ...season(A), seen: true }, season(B)],
      progress: list.progress,
    });
  });

  it('ошибка — откат только своего сезона', async () => {
    jest.mocked(api.markAchievementsSeen).mockRejectedValue(new Error('offline'));
    const { client, wrapper } = setup();
    const items = [season(A), { ...season(B), seen: true }];
    client.setQueryData(ACHIEVEMENTS_KEY, { ...list, items });
    const { result } = await renderHook(() => useMarkAchievementsSeen(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync([
          { code: 'season_podium', seasonId: A },
          { code: 'season_podium', seasonId: B },
        ])
        .catch(() => undefined);
    });
    expect(client.getQueryData(ACHIEVEMENTS_KEY)).toEqual({ ...list, items });
  });
});
