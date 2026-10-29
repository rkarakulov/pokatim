/// <reference types="jest" />
import { prepareShareImage, shareImageSupported } from './share-image.web';

type ShareNavigator = { canShare?: (data: ShareData) => boolean };
const nav = navigator as unknown as ShareNavigator;
const URL_PNG = 'https://pokatim.test/v1/og/images/route/x/0123456789abcdef.png';

describe('share-image (web)', () => {
  afterEach(() => {
    delete nav.canShare;
    jest.restoreAllMocks();
  });

  it('картинку готовим, только если браузер умеет canShare', () => {
    expect(shareImageSupported()).toBe(false);
    nav.canShare = () => true;
    expect(shareImageSupported()).toBe(true);
  });

  it('fetch → File image/png', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    const image = await prepareShareImage(URL_PNG);
    expect(global.fetch).toHaveBeenCalledWith(URL_PNG);
    expect(image.file.name).toBe('pokatim.png');
    expect(image.file.type).toBe('image/png');
  });

  it('ответ с ошибкой и обрыв сети — отказ', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(prepareShareImage(URL_PNG)).rejects.toThrow('404');
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(prepareShareImage(URL_PNG)).rejects.toThrow();
  });
});
