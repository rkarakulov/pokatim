/// <reference types="jest" />
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { prepareShareImage, shareImageSupported } from './share-image';

const ID = '0190a6f4-0000-7000-8000-000000000001';
const URL_PNG = `https://api.example/v1/og/images/route/${ID}/0123456789abcdef.png`;
const download = jest.mocked(File.downloadFileAsync);

describe('share-image (native)', () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });

  it('файл с текстом — только iOS (Android Share RN без файлов)', () => {
    Platform.OS = 'ios';
    expect(shareImageSupported()).toBe(true);
    Platform.OS = 'android';
    expect(shareImageSupported()).toBe(false);
  });

  it('PNG скачивается в кэш с именем по виду, id и версии (перезапись)', async () => {
    download.mockResolvedValueOnce({ uri: 'file:///cache/og.png' } as never);
    await expect(prepareShareImage(URL_PNG)).resolves.toEqual({ uri: 'file:///cache/og.png' });
    expect(download).toHaveBeenCalledWith(URL_PNG, expect.anything(), { idempotent: true });
    expect(download.mock.calls.at(-1)![1]).toMatchObject({
      uri: expect.stringMatching(new RegExp(`/og-route-${ID}-0123456789abcdef\\.png$`)),
    });
  });

  it('ошибка загрузки — отказ (экран делится ссылкой)', async () => {
    download.mockRejectedValueOnce(new Error('response has status 404'));
    await expect(prepareShareImage(URL_PNG)).rejects.toThrow();
  });
});
