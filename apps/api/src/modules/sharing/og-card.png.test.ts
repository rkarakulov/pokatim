import type { LonLat } from '@pokatim/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { noisyPhoto } from '../../../test/avatars';

import { OG_FIXTURES, ogFixture } from '../../../test/og-fixtures';
import type { OgCardInput } from './og-card.inputs';
import { renderOgCard } from './og-card.png';
import { OG_CARD_POLICY } from './sharing.policy';

/** Петля ≈ 1000 точек — больше лимита точек (упрощается). */
const loop: LonLat[] = Array.from({ length: 1000 }, (_, i) => {
  const a = (i / 999) * 2 * Math.PI;
  return [27.55 + 0.1 * Math.cos(a), 53.9 + 0.05 * Math.sin(a)];
});

const cases: [string, OgCardInput, LonLat[] | null][] = [
  ['гонка с линией', OG_FIXTURES.race, loop],
  ['райд без линии, длинное название', ogFixture('ride', { title: 'К'.repeat(90) }), null],
  ['маршрут с линией, тема «Ночь»', { ...OG_FIXTURES.route, themeId: 'chrono' }, loop],
  ['старт календаря', OG_FIXTURES.calendar, null],
  ['бренд', OG_FIXTURES.brand, null],
  ['тёмная гонка с линией, длинное название', ogFixture('race', { title: 'Г'.repeat(90) }), loop],
  ['тёмный сезон', OG_FIXTURES.season, null],
  ['тёмный райдер', OG_FIXTURES.rider, null],
];

describe('PNG OG-картинки (реальные satori + resvg)', () => {
  it.each(cases)('%s: PNG 1200×630, ≤ maxPngBytes', async (name, input, line) => {
    const png = await renderOgCard(input, line);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.byteLength).toBeLessThanOrEqual(OG_CARD_POLICY.maxPngBytes);
    // размер для оценки памяти Redis (R-A1)
    process.stdout.write(`og png ${name}: ${png.byteLength} B\n`);
  });
});

describe('OG райда с фото организатора (ride-photo-followups AC2)', () => {
  const ride = ogFixture('ride', { photoId: 'photo' });

  it('шумное фото: PNG 1200×630 с палитрой, ≤ maxPhotoPngBytes', async () => {
    const png = await renderOgCard(ride, loop, await noisyPhoto());
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 1200, height: 630 });
    expect(png.byteLength).toBeLessThanOrEqual(OG_CARD_POLICY.maxPhotoPngBytes);
    process.stdout.write(`og png райд с шумным фото: ${png.byteLength} B\n`);
  }, 60_000);

  it('белое фото: кадр затемнён скримом по всей высоте (текст onPhoto читается)', async () => {
    const white = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const png = await renderOgCard(ride, null, white);
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const luma = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      return ((data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0)) / 3;
    };
    // правый край без текста: верх и низ кадра под скримом заметно темнее белого
    expect(luma(1195, 5)).toBeLessThan(140);
    expect(luma(1195, 625)).toBeLessThan(80);
  }, 60_000);

  it('без фото — прежний рендер (photoId в фактах картинку не меняет)', async () => {
    const plain = await renderOgCard(ogFixture('ride', { photoId: null }), loop);
    const withId = await renderOgCard(ride, loop, null);
    expect(withId.equals(plain)).toBe(true);
  }, 60_000);
});
