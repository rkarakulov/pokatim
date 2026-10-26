/// <reference types="jest" />
import { shareLink, shareOrigin } from './share-link';

const input = { title: 'Райд', text: 'Райд — дата', path: '/rides/x' };
const url = `${window.location.origin}/rides/x`;

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};
const nav = navigator as unknown as ShareNavigator;

describe('shareLink (web)', () => {
  afterEach(() => {
    delete nav.share;
    jest.restoreAllMocks();
  });

  it('origin — текущий сайт', () => {
    expect(shareOrigin()).toBe(window.location.origin);
  });

  it('Web Share API: заголовок, текст, ссылка; закрытие окна (AbortError) — dismissed', async () => {
    nav.share = jest.fn().mockResolvedValue(undefined);
    await expect(shareLink(input)).resolves.toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ title: 'Райд', text: 'Райд — дата', url });

    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    nav.share = jest.fn().mockRejectedValue(abort);
    await expect(shareLink(input)).resolves.toBe('dismissed');
  });

  it('без Web Share — копирование ссылки в буфер', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(shareLink(input)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
  });
});
