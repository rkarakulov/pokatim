import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  avatarPixel,
  brokenJpeg,
  GIF_BYTES,
  hasGpsIfd,
  hugePng,
  twoToneImage,
} from '../../../test/avatars';
import { processCover } from './image-pipeline';

const COVER = { maxEdgePx: 1600, minShortPx: 400 };

describe('processCover — вписать в 1600 px, JPEG без метаданных', () => {
  it('4000×3000 → 1600×1200 JPEG', async () => {
    const result = await processCover(
      await twoToneImage('jpeg', { width: 4000, height: 3000 }),
      COVER,
    );
    expect(result).toMatchObject({ ok: true, format: 'jpeg', width: 1600, height: 1200 });
    if (!result.ok) return;
    expect(await sharp(result.bytes).metadata()).toMatchObject({
      format: 'jpeg',
      width: 1600,
      height: 1200,
    });
  });

  it('1200×900 — без увеличения; PNG и WebP принимаются', async () => {
    for (const format of ['png', 'webp', 'jpeg'] as const) {
      const result = await processCover(
        await twoToneImage(format, { width: 1200, height: 900 }),
        COVER,
      );
      expect(result, format).toMatchObject({ ok: true, format, width: 1200, height: 900 });
    }
  });

  it('EXIF-ориентация 6 → портрет, левая (красная) половина сверху; EXIF и GPS не пишутся', async () => {
    const input = await twoToneImage('jpeg', { orientation: 6, width: 1000, height: 600 });
    expect(hasGpsIfd((await sharp(input).metadata()).exif)).toBe(true);
    const result = await processCover(input, COVER);
    expect(result).toMatchObject({ ok: true, width: 600, height: 1000 });
    if (!result.ok) return;
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(hasGpsIfd(meta.exif)).toBe(false);
    expect(Buffer.from(result.bytes).includes(Buffer.from('PokatimTest'))).toBe(false);
    expect(await avatarPixel(result.bytes, 300, 100)).toBe('red');
    expect(await avatarPixel(result.bytes, 300, 900)).toBe('blue');
  });

  it('300×300 и панорама 12000×600 (после вписывания 1600×80) — too_small', async () => {
    expect(
      await processCover(await twoToneImage('png', { width: 300, height: 300 }), COVER),
    ).toMatchObject({ ok: false, error: 'too_small', format: 'png' });
    expect(
      await processCover(await twoToneImage('jpeg', { width: 12000, height: 600 }), COVER),
    ).toMatchObject({ ok: false, error: 'too_small', format: 'jpeg' });
  });

  it('PNG больше 25 Мп (поддельный IHDR) и битый JPEG — invalid; GIF и текст — unsupported', async () => {
    expect(await processCover(hugePng(), COVER)).toMatchObject({ ok: false, error: 'invalid' });
    expect(await processCover(brokenJpeg(), COVER)).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(await processCover(GIF_BYTES, COVER)).toEqual({ ok: false, error: 'unsupported' });
    expect(await processCover(Buffer.from('не фото'), COVER)).toEqual({
      ok: false,
      error: 'unsupported',
    });
  });

  it('сигнатура PNG, а внутри JPEG — unsupported', async () => {
    const jpeg = await twoToneImage('jpeg', { width: 800, height: 600 });
    const forged = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      jpeg,
    ]);
    const result = await processCover(forged, COVER);
    expect(result.ok).toBe(false);
  });
});
