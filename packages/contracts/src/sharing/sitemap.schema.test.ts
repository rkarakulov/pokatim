import { describe, expect, it } from 'vitest';

import {
  SITEMAP_KINDS,
  SitemapIndex,
  SitemapKind,
  SitemapPage,
  SitemapPageParams,
} from './sitemap.schema.ts';

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

describe('SitemapIndex (sitemap-index)', () => {
  it('страницы: вид, номер с 1, дата изменения; пусто — допустимо', () => {
    const body = { pages: [{ kind: 'route', page: 2, updatedAt: AT }] };
    expect(SitemapIndex.parse(body)).toEqual(body);
    expect(SitemapIndex.parse({ pages: [] })).toEqual({ pages: [] });
  });

  it('номер 0, дробный, чужой вид, не дата — ошибка', () => {
    for (const page of [
      { kind: 'race', page: 0, updatedAt: AT },
      { kind: 'race', page: 1.5, updatedAt: AT },
      { kind: 'ride', page: 1, updatedAt: AT },
      { kind: 'race', page: 1, updatedAt: 'вчера' },
    ]) {
      expect(SitemapIndex.safeParse({ pages: [page] }).success).toBe(false);
    }
  });
});

describe('SitemapPage (sitemap-index)', () => {
  it('записи: Uuid и дата изменения, без вида', () => {
    const body = { items: [{ id: ID, updatedAt: AT }] };
    expect(SitemapPage.parse(body)).toEqual(body);
    expect(SitemapPage.parse({ items: [] })).toEqual({ items: [] });
  });

  it('не Uuid, не дата — ошибка', () => {
    for (const item of [
      { id: 'x', updatedAt: AT },
      { id: ID, updatedAt: 'вчера' },
    ]) {
      expect(SitemapPage.safeParse({ items: [item] }).success).toBe(false);
    }
  });
});

describe('SitemapPageParams (sitemap-index)', () => {
  it('вид и номер страницы из пути — число', () => {
    expect(SitemapPageParams.parse({ kind: 'season', page: '12' })).toEqual({
      kind: 'season',
      page: 12,
    });
  });

  it('ноль, ведущий ноль, знак, экспонента, слишком длинный, чужой вид — ошибка', () => {
    for (const params of [
      { kind: 'race', page: '0' },
      { kind: 'race', page: '01' },
      { kind: 'race', page: '-1' },
      { kind: 'race', page: '1e3' },
      { kind: 'race', page: '1234567' },
      { kind: 'ride', page: '1' },
    ]) {
      expect(SitemapPageParams.safeParse(params).success).toBe(false);
    }
  });
});
