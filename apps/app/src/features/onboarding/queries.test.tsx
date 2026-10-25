/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { liveSession } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { PROFILE_QUERY_KEY } from '@/features/home/queries';
import { api } from '@/lib/api';

import { useSubmitSurvey } from './queries';

jest.mock('@/lib/api');

describe('useSubmitSurvey', () => {
  it('после ответа профиль помечен устаревшим — Главная перезапросит порядок разделов', async () => {
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    jest.mocked(api.submitOnboardingSurvey).mockResolvedValue({ surveyCompleted: true });
    // без таймеров сборки мусора кеша — jest не ждёт их после теста
    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
    });
    client.setQueryData(PROFILE_QUERY_KEY, { rideReasons: ['races'] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = await renderHook(() => useSubmitSurvey(), { wrapper });

    await act(() => result.current.mutateAsync({ reasons: ['calendar'] }));

    expect(client.getQueryState(PROFILE_QUERY_KEY)?.isInvalidated).toBe(true);
    client.clear();
  });
});
