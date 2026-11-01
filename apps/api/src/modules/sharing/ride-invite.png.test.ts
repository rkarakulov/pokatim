import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { RideInviteInput } from './ride-invite.inputs';
import { noisyPhoto } from '../../../test/avatars';
import { encodePhotoCard } from './photo-card.png';
import { renderRideInvite } from './ride-invite.png';
import { STORY_CARD_POLICY } from './sharing.policy';

const input = (template: 'line' | 'night'): RideInviteInput => ({
  template,
  themeId: 'classic',
  address: null,
  facts: {
    rideId: 'ride',
    title: 'Кофе-райд на Минское море',
    startsAt: new Date('2026-10-04T07:00:00Z'),
    place: 'у Дворца спорта, пр. Победителей',
    distanceKm: 42,
    paceMinKmh: 22,
    paceMaxKmh: 24,
    routeId: null,
    photoId: 'photo',
  },
});

describe('renderRideInvite — 4a с фото под затемнением (ride-photo, AC5)', () => {
  it('шумное фото: PNG 1080×1920 не больше maxPngBytes', async () => {
    const png = await renderRideInvite(input('night'), null, await noisyPhoto());
    expect(png.byteLength).toBeLessThanOrEqual(STORY_CARD_POLICY.maxPngBytes);
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 1080, height: 1920 });
  }, 60_000);

  it('белое фото: под текстом темно (скрим), середина — светлее; фото портретное — cover без полос', async () => {
    const white = await sharp({
      create: { width: 900, height: 1600, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const png = await renderRideInvite(input('night'), null, white);
    const { data, info } = await sharp(png)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const luma = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      return ((data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0)) / 3;
    };
    // правый край у самого низа — без текста: скрим ≈ 0.85 поверх белого
    expect(luma(1075, 1915)).toBeLessThan(80);
    // середина кадра (20 % высоты) светлее низа
    expect(luma(1075, 384)).toBeGreaterThan(luma(1075, 1915));
  }, 60_000);

  it('без фото — прежний рендер (фото игнорируется у `line`)', async () => {
    const photo = await noisyPhoto(800, 600);
    const line = await renderRideInvite(input('line'), null, photo);
    const lineWithout = await renderRideInvite(input('line'), null, null);
    expect(line.equals(lineWithout)).toBe(true);
  }, 60_000);
});

describe('encodePhotoCard — предел PNG с одной попыткой меньшей палитры (ревью PR A)', () => {
  const frame = async () => {
    const { data, info } = await sharp(await noisyPhoto(540, 960))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, info: { width: info.width, height: info.height, channels: info.channels } };
  };

  it('256 цветов не влезли — палитра 16 цветов в пределе; не влезло ничего — ошибка', async () => {
    const raw = await frame();
    const full = await encodePhotoCard(raw, Number.MAX_SAFE_INTEGER);
    const smaller = await encodePhotoCard(raw, full.byteLength - 1);
    expect(smaller.byteLength).toBeLessThan(full.byteLength);
    expect(await sharp(smaller).metadata()).toMatchObject({
      format: 'png',
      width: 540,
      height: 960,
    });
    await expect(encodePhotoCard(raw, 1)).rejects.toThrow(/card png too large/);
  }, 60_000);
});
