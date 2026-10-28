/// <reference types="jest" />
import { isNetworkError } from '@pokatim/api-client';

import { prepareStory, shareStory, storyPreviewSource, storyShareMode } from './share-story.web';

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};
const nav = navigator as unknown as ShareNavigator;
const URL_PNG = 'https://api.example/v1/story-cards/AbCdEfGhIjKlMnOpQrSt_-.png';

const story = () => ({
  url: URL_PNG,
  file: new File([new Uint8Array([1, 2, 3])], 'pokatim-story.png', { type: 'image/png' }),
});

describe('share-story (web)', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete nav.share;
    delete nav.canShare;
    jest.restoreAllMocks();
  });

  it('prepareStory — fetch → File image/png', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    const prepared = await prepareStory(URL_PNG);
    expect(global.fetch).toHaveBeenCalledWith(URL_PNG);
    expect(prepared.file.name).toBe('pokatim-story.png');
    expect(prepared.file.type).toBe('image/png');
  });

  it('обрыв сети (fetch / чтение тела) — ApiNetworkError; ответ сервера с ошибкой — не сетевая', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await prepareStory(URL_PNG).catch((error: unknown) => error);
    expect(isNetworkError(offline)).toBe(true);

    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, blob: () => Promise.reject(new TypeError('network')) });
    expect(isNetworkError(await prepareStory(URL_PNG).catch((error: unknown) => error))).toBe(true);

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const server = await prepareStory(URL_PNG).catch((error: unknown) => error);
    expect(server).toBeInstanceOf(Error);
    expect(isNetworkError(server)).toBe(false);
  });

  it('превью — object URL подготовленного файла; release отзывает его', () => {
    const created = jest.fn().mockReturnValue('blob:preview');
    const revoked = jest.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const s = story();
    const preview = storyPreviewSource(s);
    expect(preview.uri).toBe('blob:preview');
    expect(created).toHaveBeenCalledWith(s.file);
    preview.release();
    expect(revoked).toHaveBeenCalledWith('blob:preview');
  });

  it('canShare с файлами — navigator.share({ files }); AbortError — dismissed', async () => {
    nav.canShare = jest.fn().mockReturnValue(true);
    nav.share = jest.fn().mockResolvedValue(undefined);
    const s = story();
    expect(storyShareMode(s)).toBe('share');
    await expect(shareStory(s)).resolves.toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ files: [s.file] });

    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    nav.share = jest.fn().mockRejectedValue(abort);
    await expect(shareStory(s)).resolves.toBe('dismissed');
  });

  it('нет canShare — скачивание <a download> по blob', async () => {
    jest.useFakeTimers();
    const created = jest.fn().mockReturnValue('blob:story');
    const revoked = jest.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const s = story();
    expect(storyShareMode(s)).toBe('download');
    await expect(shareStory(s)).resolves.toBe('downloaded');
    expect(created).toHaveBeenCalledWith(s.file);
    expect(click).toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('pokatim-story.png');
    // отзыв ссылки — после старта скачивания (синхронный отзыв обрывает его в части браузеров)
    expect(revoked).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(revoked).toHaveBeenCalledWith('blob:story');
  });
});
