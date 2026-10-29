import { describe, expect, it } from 'vitest';

import {
  OG_BRAND,
  OG_CARD_SIZE,
  OgCardKind,
  OgCardMeta,
  OgCardParams,
  OgImageFile,
} from './og-card.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const V = '0123456789abcdef';

describe('OgCardKind', () => {
  it('4 вида; бренд и незнакомый — ошибка', () => {
    for (const kind of ['race', 'ride', 'route', 'calendar']) {
      expect(OgCardKind.parse(kind)).toBe(kind);
    }
    expect(OgCardKind.safeParse('brand').success).toBe(false);
    expect(OgCardKind.safeParse('season').success).toBe(false);
  });
});

describe('OgCardParams', () => {
  it('вид и Uuid', () => {
    expect(OgCardParams.parse({ kind: 'race', id: ID })).toEqual({ kind: 'race', id: ID });
  });

  it('не Uuid, лишний ключ, бренд — ошибка', () => {
    expect(OgCardParams.safeParse({ kind: 'race', id: 'site' }).success).toBe(false);
    expect(OgCardParams.safeParse({ kind: 'race', id: ID, file: 'x' }).success).toBe(false);
    expect(OgCardParams.safeParse({ kind: OG_BRAND.kind, id: ID }).success).toBe(false);
  });
});

describe('OgImageFile', () => {
  it('ровно 16 hex нижнего регистра + .png', () => {
    expect(OgImageFile.parse(`${V}.png`)).toBe(`${V}.png`);
    for (const bad of [
      `${V.toUpperCase()}.png`,
      `${V.slice(1)}.png`,
      `${V}0.png`,
      `${V}.jpg`,
      `../${V}.png`,
      `${V}.png/..`,
      V,
    ]) {
      expect(OgImageFile.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('OgCardMeta', () => {
  it('версия — 16 hex', () => {
    expect(OgCardMeta.parse({ version: V })).toEqual({ version: V });
    expect(OgCardMeta.safeParse({ version: 'abc' }).success).toBe(false);
    expect(OgCardMeta.safeParse({}).success).toBe(false);
  });

  it('размер 1200×630', () => {
    expect(OG_CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });
});
