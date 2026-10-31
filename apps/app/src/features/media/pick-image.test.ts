/// <reference types="jest" />
import { imagePickerSupported } from './image-picker-support';
import { loadImagePicker } from './load-image-picker';
import { pickImage } from './pick-image';
import { ImagePickerUnavailableError, ImagePrecheckError } from './picked-image';

jest.mock('./image-picker-support', () => ({ imagePickerSupported: jest.fn(() => true) }));
jest.mock('./load-image-picker', () => ({ loadImagePicker: jest.fn() }));

const MAX = 1000;
const launch = jest.fn();
const blob = new Blob(['jpeg']);
const fetchMock = jest.fn();

beforeEach(() => {
  jest.mocked(loadImagePicker).mockResolvedValue({
    launchImageLibraryAsync: launch,
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
  } as never);
  fetchMock.mockResolvedValue({ blob: () => Promise.resolve(blob) });
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  jest.clearAllMocks();
});

const asset = (extra: object) =>
  launch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///tmp/ride.jpg', width: 1600, height: 1200, ...extra }],
  });

describe('pickImage (native)', () => {
  it('без обрезки: галерея без редактора, HEIC iOS — в совместимый JPEG; байты — Blob', async () => {
    asset({ fileSize: 500, mimeType: 'image/jpeg' });
    await expect(pickImage({ maxBytes: MAX, square: false })).resolves.toEqual({ body: blob });
    expect(launch).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: false,
      preferredAssetRepresentationMode: 'compatible',
      quality: 0.9,
      exif: false,
      base64: false,
    });
    expect(fetchMock).toHaveBeenCalledWith('file:///tmp/ride.jpg');
  });

  it('квадрат: системная обрезка 1:1 (аватар)', async () => {
    asset({ fileSize: 500 });
    await pickImage({ maxBytes: MAX, square: true });
    expect(launch).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
      base64: false,
    });
  });

  it('отмена — null, файл не читается', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImage({ maxBytes: MAX, square: false })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('больше предела — отказ до чтения файла', async () => {
    asset({ fileSize: MAX + 1 });
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toEqual(
      new ImagePrecheckError('tooLarge'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('размер неизвестен до чтения — проверка по Blob', async () => {
    asset({});
    fetchMock.mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'.repeat(MAX + 1)])) });
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toMatchObject({
      reason: 'tooLarge',
    });
  });

  it('HEIF с Android — отказ формата до отправки', async () => {
    asset({ fileSize: 500, mimeType: 'image/heif' });
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toMatchObject({
      reason: 'formatUnsupported',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('старый dev-клиент без модуля — «обновите приложение», пакет не загружается', async () => {
    jest.mocked(imagePickerSupported).mockReturnValueOnce(false);
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toBeInstanceOf(
      ImagePickerUnavailableError,
    );
    expect(loadImagePicker).not.toHaveBeenCalled();
  });
});
