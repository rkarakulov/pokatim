/// <reference types="jest" />
import { getDocumentAsync } from 'expo-document-picker';

import { pickImage } from './pick-image';
import { ImagePrecheckError } from './picked-image';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const MAX = 1000;
const pick = jest.mocked(getDocumentAsync);
const picked = (file: File) =>
  pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: file.name, uri: 'blob:x', file } as never],
  });

afterEach(() => {
  jest.clearAllMocks();
});

describe('pickImage (web)', () => {
  it('фильтр JPEG/PNG/WebP, без base64; отправляется сам File', async () => {
    const file = new File(['x'], 'ride.jpg', { type: 'image/jpeg' });
    picked(file);
    await expect(pickImage({ maxBytes: MAX, square: false })).resolves.toEqual({
      body: file,
      file,
    });
    expect(pick).toHaveBeenCalledWith({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      multiple: false,
      base64: false,
    });
  });

  it('отмена — null', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImage({ maxBytes: MAX, square: false })).resolves.toBeNull();
  });

  it('HEIC (Safari на iPhone) — отказ формата до отправки', async () => {
    picked(new File(['x'], 'ride.heic', { type: 'image/heic' }));
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toEqual(
      new ImagePrecheckError('formatUnsupported'),
    );
  });

  it('больше предела — отказ размера до отправки', async () => {
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MAX + 1 });
    picked(big);
    await expect(pickImage({ maxBytes: MAX, square: false })).rejects.toMatchObject({
      reason: 'tooLarge',
    });
  });
});
