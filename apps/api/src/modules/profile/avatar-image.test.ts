import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { cropRect, detectImageFormat, processAvatar } from './avatar-image';
import { avatarPixel, brokenJpeg, GIF_BYTES, hugePng, twoToneImage } from '../../../test/avatars';

describe('detectImageFormat — по сигнатуре', () => {
  it('JPEG, PNG, WebP', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(
      detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('png');
    expect(detectImageFormat(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe(
      'webp',
    );
  });

  it('GIF, текст, короткий и пустой вход — null', () => {
    expect(detectImageFormat(GIF_BYTES)).toBeNull();
    expect(detectImageFormat(Buffer.from('hello world, not an image'))).toBeNull();
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE', 'latin1'))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });
});

describe('cropRect — квадрат в рамках изображения', () => {
  it('без обрезки — центральный квадрат меньшей стороны', () => {
    expect(cropRect(400, 200, null)).toEqual({ left: 100, top: 0, width: 200, height: 200 });
    expect(cropRect(200, 400, null)).toEqual({ left: 0, top: 100, width: 200, height: 200 });
    expect(cropRect(300, 300, null)).toEqual({ left: 0, top: 0, width: 300, height: 300 });
  });

  it('доли изображения: x — ширины, y — высоты, size — меньшей стороны', () => {
    expect(cropRect(400, 200, { x: 0.5, y: 0, size: 1 })).toEqual({
      left: 200,
      top: 0,
      width: 200,
      height: 200,
    });
    expect(cropRect(400, 200, { x: 0.25, y: 0.25, size: 0.5 })).toEqual({
      left: 100,
      top: 50,
      width: 100,
      height: 100,
    });
  });

  it('выход за рамки — сдвиг внутрь', () => {
    expect(cropRect(400, 200, { x: 1, y: 1, size: 0.5 })).toEqual({
      left: 300,
      top: 100,
      width: 100,
      height: 100,
    });
  });

  it('сторона меньше 64 px — null', () => {
    expect(cropRect(400, 200, { x: 0, y: 0, size: 0.3 })).toBeNull();
    expect(cropRect(400, 200, { x: 0, y: 0, size: 0.32 })).toEqual({
      left: 0,
      top: 0,
      width: 64,
      height: 64,
    });
    expect(cropRect(50, 50, null)).toBeNull();
  });
});

describe('processAvatar', () => {
  it('JPEG с EXIF (GPS, ориентация 6) → 512×512 JPEG без метаданных, развёрнут по ориентации', async () => {
    // 400×200: слева красный, справа синий; ориентация 6 — поворот на 90° по часовой: красный сверху
    const input = await twoToneImage('jpeg', { orientation: 6 });
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();

    const result = await processAvatar(input, null);
    if (!result.ok) throw new Error(result.error);
    const meta = await sharp(result.bytes).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(await avatarPixel(result.bytes, 256, 40)).toBe('red');
    expect(await avatarPixel(result.bytes, 256, 470)).toBe('blue');
  });

  it('обрезка по долям: правая половина 400×200 — синий квадрат', async () => {
    const input = await twoToneImage('jpeg');
    const result = await processAvatar(input, { x: 0.5, y: 0, size: 1 });
    if (!result.ok) throw new Error(result.error);
    expect(await avatarPixel(result.bytes, 20, 20)).toBe('blue');
    expect(await avatarPixel(result.bytes, 490, 490)).toBe('blue');
  });

  it('PNG и WebP принимаются', async () => {
    for (const format of ['png', 'webp'] as const) {
      const result = await processAvatar(await twoToneImage(format), { x: 0, y: 0, size: 1 });
      if (!result.ok) throw new Error(`${format}: ${result.error}`);
      expect(await avatarPixel(result.bytes, 256, 256)).toBe('red');
    }
  });

  it('GIF и текст — unsupported; сигнатура не совпала с декодером — unsupported', async () => {
    expect(await processAvatar(GIF_BYTES, null)).toEqual({ ok: false, error: 'unsupported' });
    expect(await processAvatar(Buffer.from('text'), null)).toEqual({
      ok: false,
      error: 'unsupported',
    });
    const png = await twoToneImage('png');
    // заголовок JPEG + тело PNG
    const forged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png]);
    expect((await processAvatar(forged, null)).ok).toBe(false);
  });

  it('больше 40 Мп (поддельный IHDR) и битый JPEG — invalid', async () => {
    expect(await processAvatar(hugePng(), null)).toMatchObject({ ok: false, error: 'invalid' });
    expect(await processAvatar(brokenJpeg(), null)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('мелкая обрезка — invalid', async () => {
    expect(
      await processAvatar(await twoToneImage('jpeg'), { x: 0, y: 0, size: 0.1 }),
    ).toMatchObject({
      ok: false,
      error: 'invalid',
    });
  });
});
