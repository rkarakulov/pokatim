import { describe, expect, it } from 'vitest';

import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_INPUT_PIXELS,
  AVATAR_MIN_CROP_PX,
  AVATAR_SIZE_PX,
  AvatarCropQuery,
  AvatarId,
  RiderPublicId,
} from './rider-avatar.schema.ts';

const TOKEN = 'Ab0_-'.repeat(8) + 'xyz';

describe('rider-avatar: пределы', () => {
  it('10 МиБ, 512 px, 40 Мп, обрезка от 64 px', () => {
    expect(AVATAR_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(AVATAR_SIZE_PX).toBe(512);
    expect(AVATAR_MAX_INPUT_PIXELS).toBe(40_000_000);
    expect(AVATAR_MIN_CROP_PX).toBe(64);
  });
});

describe('AvatarId / RiderPublicId — непрозрачный токен', () => {
  it('43 символа base64url', () => {
    expect(TOKEN).toHaveLength(43);
    expect(AvatarId.parse(TOKEN)).toBe(TOKEN);
    expect(RiderPublicId.parse(TOKEN)).toBe(TOKEN);
  });

  it('другая длина, другой алфавит, не строка — ошибка', () => {
    expect(AvatarId.safeParse(TOKEN.slice(1)).success).toBe(false);
    expect(AvatarId.safeParse(`${TOKEN}a`).success).toBe(false);
    expect(AvatarId.safeParse(`${TOKEN.slice(1)}=`).success).toBe(false);
    expect(RiderPublicId.safeParse(`${TOKEN.slice(1)}/`).success).toBe(false);
    expect(RiderPublicId.safeParse(42).success).toBe(false);
  });
});

describe('AvatarCropQuery', () => {
  it('без query — пустой объект (центральный квадрат)', () => {
    expect(AvatarCropQuery.parse({})).toEqual({});
  });

  it('доли 0..1 из строк query', () => {
    expect(AvatarCropQuery.parse({ x: '0.25', y: '0', size: '0.5' })).toEqual({
      x: 0.25,
      y: 0,
      size: 0.5,
    });
    expect(AvatarCropQuery.parse({ x: '1', y: '1', size: '1' })).toEqual({ x: 1, y: 1, size: 1 });
  });

  it('все три или ни одного; вне 0..1, size 0, NaN, Infinity, лишний ключ — ошибка', () => {
    for (const bad of [
      { x: '0.1' },
      { x: '0.1', y: '0.1' },
      { x: '-0.1', y: '0', size: '0.5' },
      { x: '0', y: '1.1', size: '0.5' },
      { x: '0', y: '0', size: '0' },
      { x: '0', y: '0', size: '1.5' },
      { x: 'NaN', y: '0', size: '0.5' },
      { x: 'Infinity', y: '0', size: '0.5' },
      { x: 'abc', y: '0', size: '0.5' },
      { x: '0', y: '0', size: '0.5', userId: 'x' },
      { other: '1' },
    ]) {
      expect(AvatarCropQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
