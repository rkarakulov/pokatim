/// <reference types="jest" />
import { shareLink, shareOrigin } from './share-link.web';

const input = { title: 'Райд', text: 'Райд — дата', path: '/rides/x' };
const url = `${window.location.origin}/rides/x`;

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};
const nav = navigator as unknown as ShareNavigator;

describe('shareLink (web)', () => {
  afterEach(() => {
    delete nav.share;
    delete nav.canShare;
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

  describe('с картинкой файлом', () => {
    const image = { file: new File(['png'], 'pokatim.png', { type: 'image/png' }) };

    it('canShare с файлами — файл, заголовок, текст со ссылкой (url с файлами Android Chrome теряет)', async () => {
      nav.canShare = jest.fn().mockReturnValue(true);
      nav.share = jest.fn().mockResolvedValue(undefined);
      await expect(shareLink({ ...input, image })).resolves.toBe('shared');
      expect(nav.canShare).toHaveBeenCalledWith({ files: [image.file] });
      expect(nav.share).toHaveBeenCalledWith({
        files: [image.file],
        title: 'Райд',
        text: `Райд — дата\n${url}`,
      });
    });

    it('share вызывается синхронно, в пределах жеста (до любого await)', () => {
      nav.canShare = jest.fn().mockReturnValue(true);
      nav.share = jest.fn().mockResolvedValue(undefined);
      void shareLink({ ...input, image });
      expect(nav.share).toHaveBeenCalledTimes(1);
    });

    it('файлы не поддерживаются (canShare — false или нет) — ссылка, как без картинки', async () => {
      nav.canShare = jest.fn().mockReturnValue(false);
      nav.share = jest.fn().mockResolvedValue(undefined);
      await expect(shareLink({ ...input, image })).resolves.toBe('shared');
      expect(nav.share).toHaveBeenCalledWith({ title: 'Райд', text: 'Райд — дата', url });

      delete nav.canShare;
      nav.share = jest.fn().mockResolvedValue(undefined);
      await expect(shareLink({ ...input, image })).resolves.toBe('shared');
      expect(nav.share).toHaveBeenCalledWith({ title: 'Райд', text: 'Райд — дата', url });
    });

    it('без Web Share — копирование ссылки и с картинкой', async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await expect(shareLink({ ...input, image })).resolves.toBe('copied');
      expect(writeText).toHaveBeenCalledWith(url);
    });
  });
});
