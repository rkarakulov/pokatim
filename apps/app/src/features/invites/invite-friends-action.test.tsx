/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import { liveSession } from '@/__tests__/auth-fixtures';
import { useSessionStore } from '@/features/auth/session-store';
import { createQueryWrapper } from '@/__tests__/query-wrapper';
import { api } from '@/lib/api';
import { setShareInvite } from '@/lib/share-invite';

import { InviteFriendsAction, inviteFriendsPath } from './invite-friends-action';

jest.mock('@/lib/api');

const getInviteCode = jest.mocked(api.getInviteCode);
const PUBLIC_ID = 'r'.repeat(43);

beforeEach(() => {
  process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://pokatim.by';
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
  setShareInvite(null);
  jest.restoreAllMocks();
});

describe('inviteFriendsPath (P6)', () => {
  it('публичный профиль — /riders/<publicId>, иначе — главная', () => {
    expect(inviteFriendsPath(PUBLIC_ID)).toBe(`/riders/${PUBLIC_ID}`);
    expect(inviteFriendsPath(null)).toBe('/');
  });
});

describe('«Позвать друзей» (P6, AC3)', () => {
  it('делится ссылкой на публичный профиль с кодом', async () => {
    getInviteCode.mockResolvedValue({ code: 'K7M2PQX' });
    // код в ссылки ставит InviteShareSync корня — здесь вручную
    setShareInvite('K7M2PQX');
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await render(<InviteFriendsAction publicId={PUBLIC_ID} />, { wrapper: createQueryWrapper() });
    await fireEvent.press(await screen.findByRole('button', { name: 'Позвать друзей' }));
    expect(sheet).toHaveBeenCalledWith(
      expect.objectContaining({ url: `https://pokatim.by/riders/${PUBLIC_ID}?invite=K7M2PQX` }),
    );
  });

  it('без публичного профиля — главная с кодом', async () => {
    getInviteCode.mockResolvedValue({ code: 'K7M2PQX' });
    setShareInvite('K7M2PQX');
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await render(<InviteFriendsAction publicId={null} />, { wrapper: createQueryWrapper() });
    await fireEvent.press(await screen.findByRole('button', { name: 'Позвать друзей' }));
    expect(sheet).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://pokatim.by/?invite=K7M2PQX' }),
    );
  });

  it('код не получен (ошибка) — кнопки нет', async () => {
    getInviteCode.mockRejectedValue(new Error('offline'));
    await render(<InviteFriendsAction publicId={PUBLIC_ID} />, { wrapper: createQueryWrapper() });
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Позвать друзей' })).toBeNull();
  });

  it('без origin шеринга — кнопки нет', async () => {
    delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
    getInviteCode.mockResolvedValue({ code: 'K7M2PQX' });
    await render(<InviteFriendsAction publicId={PUBLIC_ID} />, { wrapper: createQueryWrapper() });
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Позвать друзей' })).toBeNull();
  });
});
