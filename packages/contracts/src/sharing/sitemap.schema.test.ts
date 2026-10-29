import { describe, expect, it } from 'vitest';

import { SITEMAP_KINDS, SitemapEntries, SitemapKind } from './sitemap.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-29T10:00:00.000Z';

describe('SitemapKind', () => {
  it('гонка, сезон, маршрут, старт календаря; райд и профиль — ошибка', () => {
    expect(SITEMAP_KINDS).toEqual(['race', 'season', 'route', 'calendar']);
    for (const kind of SITEMAP_KINDS) expect(SitemapKind.parse(kind)).toBe(kind);
    expect(SitemapKind.safeParse('ride').success).toBe(false);
    expect(SitemapKind.safeParse('rider').success).toBe(false);
  });
});

describe('SitemapEntries', () => {
  it('записи: вид, Uuid, дата изменения', () => {
    const body = { items: [{ kind: 'race', id: ID, updatedAt: AT }] };
    expect(SitemapEntries.parse(body)).toEqual(body);
    expect(SitemapEntries.parse({ items: [] })).toEqual({ items: [] });
  });

  it('не Uuid, не дата, чужой вид — ошибка', () => {
    for (const item of [
      { kind: 'race', id: 'x', updatedAt: AT },
      { kind: 'race', id: ID, updatedAt: 'вчера' },
      { kind: 'ride', id: ID, updatedAt: AT },
    ]) {
      expect(SitemapEntries.safeParse({ items: [item] }).success).toBe(false);
    }
  });
});
