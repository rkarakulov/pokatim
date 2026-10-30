import { describe, expect, it } from 'vitest';

import {
  OG_BRAND,
  OG_CARD_ID,
  OG_CARD_KINDS,
  OG_CARD_SIZE,
  OgCardKind,
  OgCardMeta,
  OgCardParams,
  OgImageFile,
  OgImageParams,
} from './og-card.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const PUBLIC_ID = 'a'.repeat(43);
const V = '0123456789abcdef';

describe('OgCardKind', () => {
  it('6 видов (новые — в конец); бренд и незнакомый — ошибка', () => {
    expect(OG_CARD_KINDS).toEqual(['race', 'ride', 'route', 'calendar', 'season', 'rider']);
    for (const kind of OG_CARD_KINDS) expect(OgCardKind.parse(kind)).toBe(kind);
    expect(OgCardKind.safeParse('brand').success).toBe(false);
    expect(OgCardKind.safeParse('team').success).toBe(false);
  });
});

describe('OgCardParams — id по виду (OG_CARD_ID)', () => {
  it('объекты — Uuid, райдер — RiderPublicId', () => {
    for (const kind of ['race', 'ride', 'route', 'calendar', 'season'] as const) {
      expect(OG_CARD_ID[kind].safeParse(ID).success, kind).toBe(true);
      expect(OgCardParams.parse({ kind, id: ID })).toEqual({ kind, id: ID });
    }
    expect(OgCardParams.parse({ kind: 'rider', id: PUBLIC_ID })).toEqual({
      kind: 'rider',
      id: PUBLIC_ID,
    });
  });

  it('id не своего вида — ошибка поля id с кодом INVALID', () => {
    for (const [kind, id] of [
      ['rider', ID],
      ['season', PUBLIC_ID],
      ['race', PUBLIC_ID],
      ['season', 'site'],
      ['rider', '../x'],
    ] as const) {
      const result = OgCardParams.safeParse({ kind, id });
      expect(result.success, `${kind} ${id}`).toBe(false);
      expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['id', 'INVALID'],
      ]);
    }
  });

  it('не Uuid, лишний ключ, бренд, незнакомый вид — ошибка', () => {
    expect(OgCardParams.safeParse({ kind: 'race', id: 'site' }).success).toBe(false);
    expect(OgCardParams.safeParse({ kind: 'race', id: ID, file: 'x' }).success).toBe(false);
    expect(OgCardParams.safeParse({ kind: OG_BRAND.kind, id: ID }).success).toBe(false);
    expect(OgCardParams.safeParse({ kind: 'team', id: ID }).success).toBe(false);
  });
});

describe('OgImageParams', () => {
  it('вид, id по виду и файл версии; лишний ключ — ошибка', () => {
    const file = `${V}.png`;
    expect(OgImageParams.parse({ kind: 'rider', id: PUBLIC_ID, file })).toEqual({
      kind: 'rider',
      id: PUBLIC_ID,
      file,
    });
    expect(OgImageParams.parse({ kind: 'season', id: ID, file })).toEqual({
      kind: 'season',
      id: ID,
      file,
    });
    expect(OgImageParams.safeParse({ kind: 'rider', id: ID, file }).success).toBe(false);
    expect(OgImageParams.safeParse({ kind: 'season', id: ID, file: 'x.png' }).success).toBe(false);
    expect(OgImageParams.safeParse({ kind: 'season', id: ID, file, x: 1 }).success).toBe(false);
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
