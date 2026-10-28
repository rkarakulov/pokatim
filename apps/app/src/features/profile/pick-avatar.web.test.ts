/// <reference types="jest" />
import { AVATAR_MAX_BYTES } from '@pokatim/contracts';
import { getDocumentAsync } from 'expo-document-picker';

import { pickAvatar } from './pick-avatar';
import { AvatarPrecheckError } from './picked-avatar';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const pick = jest.mocked(getDocumentAsync);
const picked = (file: File) =>
  pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: file.name, uri: 'blob:x', file } as never],
  });

afterEach(() => {
  jest.clearAllMocks();
});

describe('pickAvatar (web, AC14)', () => {
  it('фильтр JPEG/PNG/WebP, без base64; отправляется сам File, обрезку делает редактор', async () => {
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
    picked(file);
    await expect(pickAvatar()).resolves.toEqual({ body: file, file });
    expect(pick).toHaveBeenCalledWith({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      multiple: false,
      base64: false,
    });
  });

  it('отмена — null', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAvatar()).resolves.toBeNull();
  });

  it('HEIC (Safari на iPhone) — отказ формата до отправки', async () => {
    picked(new File(['x'], 'me.heic', { type: 'image/heic' }));
    await expect(pickAvatar()).rejects.toEqual(
      new AvatarPrecheckError('AVATAR_FORMAT_UNSUPPORTED'),
    );
  });

  it('больше 10 МиБ — отказ размера до отправки', async () => {
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: AVATAR_MAX_BYTES + 1 });
    picked(big);
    await expect(pickAvatar()).rejects.toMatchObject({ reason: 'AVATAR_TOO_LARGE' });
  });
});
