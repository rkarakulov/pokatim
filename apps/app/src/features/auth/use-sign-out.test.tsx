/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { liveSession, signInForTest } from '@/__tests__/auth-fixtures';
import { rememberPushToken, storedPushToken } from '@/features/notifications/push';
import { api } from '@/lib/api';

import { useSessionStore } from './session-store';
import { useSignOut } from './use-sign-out';

jest.mock('@/lib/api', () => ({
  api: { signOut: jest.fn(async () => undefined), revokePushToken: jest.fn() },
}));

const revoke = jest.mocked(api.revokePushToken);
const TOKEN = 'ExpoPushToken[test-device-token]';

async function renderSignOut() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = await renderHook(() => useSignOut(), { wrapper });
  return result.current;
}

beforeEach(async () => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  await rememberPushToken(TOKEN);
});
afterEach(() => jest.clearAllMocks());

describe('useSignOut — push-токен устройства (ADR-0017)', () => {
  it('выход снимает токен до отзыва сессии', async () => {
    const statusAtRevoke: string[] = [];
    revoke.mockImplementation(async () => {
      statusAtRevoke.push(useSessionStore.getState().status);
    });
    const signOut = await renderSignOut();

    await signOut();

    expect(revoke).toHaveBeenCalledWith(liveSession.accessToken, { token: TOKEN });
    expect(statusAtRevoke).toEqual(['signedIn']);
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(await storedPushToken()).toBeNull();
  });

  it('сбой снятия не мешает выходу', async () => {
    revoke.mockRejectedValue(new Error('offline'));
    const signOut = await renderSignOut();

    await signOut();

    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(await storedPushToken()).toBeNull();
  });

  it('после удаления аккаунта (`serverEnded`) — без запроса, устройство только забывает токен', async () => {
    const signOut = await renderSignOut();

    await signOut({ returning: false, notice: 'accountDeleted', serverEnded: true });

    expect(revoke).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(await storedPushToken()).toBeNull();
  });
});
