/// <reference types="jest" />
import { AVATAR_MAX_BYTES } from '@pokatim/contracts';

import { imagePickerSupported } from '@/features/media/image-picker-support';
import { loadImagePicker } from '@/features/media/load-image-picker';
import { pickAvatar } from './pick-avatar';
import { AvatarPickerUnavailableError } from './picked-avatar';

jest.mock('@/features/media/image-picker-support', () => ({
  imagePickerSupported: jest.fn(() => true),
}));
jest.mock('@/features/media/load-image-picker', () => ({ loadImagePicker: jest.fn() }));

const launch = jest.fn();
const blob = new Blob(['jpeg']);
const fetchMock = jest.fn();

beforeEach(() => {
  jest.mocked(loadImagePicker).mockResolvedValue({ launchImageLibraryAsync: launch } as never);
  fetchMock.mockResolvedValue({ blob: () => Promise.resolve(blob) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('pickAvatar (native, AC14)', () => {
  it('системная галерея с обрезкой 1:1, без EXIF и base64; байты файла — Blob, без crop', async () => {
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/me.jpg', fileSize: 1000, width: 512, height: 512 }],
    });
    await expect(pickAvatar()).resolves.toEqual({ body: blob });
    expect(launch).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
      base64: false,
    });
    expect(fetchMock).toHaveBeenCalledWith('file:///tmp/me.jpg');
  });

  it('отмена — null, файл не читается', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAvatar()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('больше 10 МиБ — отказ до чтения файла', async () => {
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/big.jpg', fileSize: AVATAR_MAX_BYTES + 1 }],
    });
    await expect(pickAvatar()).rejects.toMatchObject({ reason: 'AVATAR_TOO_LARGE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('старый dev-клиент без модуля — «обновите приложение», пакет не загружается', async () => {
    jest.mocked(imagePickerSupported).mockReturnValueOnce(false);
    await expect(pickAvatar()).rejects.toBeInstanceOf(AvatarPickerUnavailableError);
    expect(loadImagePicker).not.toHaveBeenCalled();
  });
});
