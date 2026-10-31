/// <reference types="jest" />
import { act, render } from '@testing-library/react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { signInForTest } from '@/__tests__/auth-fixtures';
import { createQueryWrapper } from '@/__tests__/query-wrapper';
import { setShareInvite, withInvite } from '@/lib/share-invite';

import { InviteCapture } from './invite-capture';
import { INVITE_KEY } from './invite-state';
import { InviteShareSync } from './invite-share-sync';

const mockParams: { invite?: string | string[] } = {};
jest.mock('expo-router', () => ({ useGlobalSearchParams: () => mockParams }));

const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const stored = () => {
  const raw = store().get(INVITE_KEY);
  return raw ? (JSON.parse(raw) as { code: string }).code : null;
};

afterEach(() => {
  delete mockParams.invite;
});

describe('InviteCapture (P6, RC-P6-7)', () => {
  it('гость с ?invite= — код сохранён', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    mockParams.invite = 'k7m2pqx';
    await render(<InviteCapture />);
    await act(async () => undefined);
    expect(stored()).toBe('K7M2PQX');
  });

  it('сессия ещё неизвестна — сохраняем (код читает только регистрация)', async () => {
    mockParams.invite = ['K7M2PQX', 'Z9Z9Z9Z'];
    await render(<InviteCapture />);
    await act(async () => undefined);
    expect(stored()).toBe('K7M2PQX');
  });

  it('вошедший — не сохраняется', async () => {
    signInForTest();
    mockParams.invite = 'K7M2PQX';
    await render(<InviteCapture />);
    await act(async () => undefined);
    expect(stored()).toBeNull();
  });

  it('без параметра — ничего', async () => {
    await render(<InviteCapture />);
    await act(async () => undefined);
    expect(stored()).toBeNull();
  });
});

// InviteShareSync — без сети: у гостя запрос кода выключен, код в ссылки не ставится
describe('InviteShareSync (P6)', () => {
  it('гость — ссылки без кода', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    setShareInvite('K7M2PQX');
    await render(<InviteShareSync />, { wrapper: createQueryWrapper() });
    await act(async () => undefined);
    expect(withInvite('/rides/x')).toBe('/rides/x');
  });
});
