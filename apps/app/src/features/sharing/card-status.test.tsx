/// <reference types="jest" />
import { appThemes, appThemeScheme, type AppThemeId } from '@pokatim/design-tokens';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { createQueryWrapper, createTestQueryClient } from '@/__tests__/query-wrapper';
import { activeAppTheme, AppThemeContext } from '@/theme/app-theme-provider';

import {
  invalidateCardStatuses,
  STORY_POLL_LIMIT_MS,
  useCardStatus,
  type CardSource,
} from './card-status';

jest.mock('@/features/auth/authorized', () => ({
  withAccessToken: (run: (token: string) => unknown) => run('access'),
}));

const fetchCard = jest.fn();
const source: CardSource = {
  key: (template) => ['test-card', template],
  fetch: (token, template) => fetchCard(token, template),
};

// тема приложения, которую видит хук (переключается между `rerender`)
let themeId: AppThemeId = 'classic';
const client = createTestQueryClient();
const queries = createQueryWrapper(client);
function Wrapper({ children }: { children: ReactNode }) {
  const def = appThemes[themeId];
  return (
    <AppThemeContext.Provider value={activeAppTheme(def, appThemeScheme(def, 'light'))}>
      {queries({ children })}
    </AppThemeContext.Provider>
  );
}

describe('useCardStatus', () => {
  afterAll(() => client.clear());

  it('смена темы приложения — новый запрос, а не карточка прошлой темы из кэша', async () => {
    fetchCard
      .mockResolvedValueOnce({ status: 'ready', token: 'classic-card' })
      .mockResolvedValueOnce({ status: 'ready', token: 'atlas-card' });
    const { result, rerender, unmount } = await renderHook(
      () => useCardStatus(source, 'line', true),
      {
        wrapper: Wrapper,
      },
    );
    await waitFor(() => expect(result.current.state.data?.token).toBe('classic-card'));

    themeId = 'atlas';
    await rerender({});
    await waitFor(() => expect(result.current.state.data?.token).toBe('atlas-card'));
    expect(fetchCard).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('ответ до сохранения темы (карточка прежней) — инвалидация после сохранения перезапрашивает', async () => {
    client.clear();
    fetchCard.mockReset();
    themeId = 'journal';
    fetchCard
      .mockResolvedValueOnce({ status: 'ready', token: 'old-theme-card' })
      .mockResolvedValueOnce({ status: 'ready', token: 'journal-card' });
    const { result, unmount } = await renderHook(() => useCardStatus(source, 'line', true), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.state.data?.token).toBe('old-theme-card'));

    await act(() => invalidateCardStatuses(client));
    await waitFor(() => expect(result.current.state.data?.token).toBe('journal-card'));
    expect(fetchCard).toHaveBeenCalledTimes(2);
    await unmount();
  });

  it('смена темы во время ожидания — свой отсчёт 30 с, без мгновенного «не готова»', async () => {
    client.clear();
    fetchCard.mockReset();
    fetchCard.mockResolvedValue({ status: 'pending' });
    themeId = 'classic';
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const { result, rerender, unmount } = await renderHook(
      () => useCardStatus(source, 'line', true),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(fetchCard).toHaveBeenCalled());

    // ожидание прежней темы почти исчерпано — новая тема начинает свой отсчёт
    now.mockReturnValue(start + STORY_POLL_LIMIT_MS + 1);
    themeId = 'atlas';
    await rerender({});
    await waitFor(() => expect(fetchCard.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(result.current.state.isError).toBe(false);
    expect(result.current.state.isPending).toBe(true);
    await unmount();
    now.mockRestore();
  });
});
