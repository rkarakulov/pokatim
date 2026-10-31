/// <reference types="jest" />
import { Share } from 'react-native';

import { setShareInvite } from './share-invite';
import { shareLink, shareOrigin } from './share-link';

const input = {
  title: 'Райд',
  text: 'Райд — Воскресенье, 4 октября 2026, 10:00, Минск',
  path: '/rides/x',
};

describe('shareLink (native)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_WEB_ORIGIN;
    jest.restoreAllMocks();
  });

  it('origin — EXPO_PUBLIC_WEB_ORIGIN без слеша в конце; не задан — null', () => {
    expect(shareOrigin()).toBeNull();
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://pokatim.by/';
    expect(shareOrigin()).toBe('https://pokatim.by');
  });

  it('системный share sheet: текст + ссылка на web-карточку; закрыто — dismissed', async () => {
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://pokatim.by';
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await expect(shareLink(input)).resolves.toBe('shared');
    expect(sheet).toHaveBeenCalledWith({
      title: 'Райд',
      message: `${input.text}\nhttps://pokatim.by/rides/x`,
      url: 'https://pokatim.by/rides/x',
    });
    sheet.mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await expect(shareLink(input)).resolves.toBe('dismissed');
  });

  it('вошедший — ссылка с ?invite=<код> (P6, AC2)', async () => {
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://pokatim.by';
    setShareInvite('K7M2PQX');
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await shareLink(input);
    setShareInvite(null);
    expect(sheet).toHaveBeenCalledWith({
      title: 'Райд',
      message: `${input.text}\nhttps://pokatim.by/rides/x?invite=K7M2PQX`,
      url: 'https://pokatim.by/rides/x?invite=K7M2PQX',
    });
  });

  it('без origin — ошибка (кнопки на экране нет)', async () => {
    await expect(shareLink(input)).rejects.toThrow();
  });

  it('с картинкой (iOS): файл в url, текст со ссылкой — в message', async () => {
    process.env.EXPO_PUBLIC_WEB_ORIGIN = 'https://pokatim.by';
    const sheet = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await expect(shareLink({ ...input, image: { uri: 'file:///cache/og.png' } })).resolves.toBe(
      'shared',
    );
    expect(sheet).toHaveBeenCalledWith({
      title: 'Райд',
      message: `${input.text}\nhttps://pokatim.by/rides/x`,
      url: 'file:///cache/og.png',
    });
  });
});
