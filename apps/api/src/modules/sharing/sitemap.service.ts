import { Inject, Injectable } from '@nestjs/common';
import {
  SITEMAP_KINDS,
  type SitemapIndex,
  type SitemapKind,
  type SitemapPage,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { ChangedRow } from '../../changed-since';
import { CALENDAR_FOR_SHARING, type CalendarForSharing } from '../calendar';
import { RACES_FOR_SHARING, type RacesForSharing } from '../races';
import { ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { SITEMAP_POLICY } from './sharing.policy';

/** Страница вида: строго после `after` (`null` — с начала) до `last` включительно; `updatedAt` — максимум строк. */
interface PageBounds {
  after: string | null;
  last: string;
  updatedAt: Date;
}
type Bounds = Record<SitemapKind, PageBounds[]>;
type Source = (afterId: string | null, limit: number) => Promise<ChangedRow[]>;
interface Memo<T> {
  expiresAt: number;
  value: Promise<T>;
}

/**
 * Карта сайта (landing-seo, sitemap-index): публичные гонки, сезоны, маршруты каталога и старты календаря — порты
 * владельцев, keyset по `_id` ↑ (uuidv7: правка объекта не переносит его между страницами, новые — в конец). Кофе-райдов
 * и профилей нет — их страницы `noindex`.
 *
 * Индекс — полный проход по каждому виду, в памяти только границы страниц по `pageSize` (O(страниц)). Страница `n` —
 * keyset `(after, last]` границ индекса (не больше `fileUrlMax`), последняя — `(after, ∞)` не больше `pageSize`: новые
 * объекты после сборки индекса — в следующем окне. Индекс и страницы запоминаются в процессе на `memoMs` (страниц — не
 * больше `pageMemoMax`, ключ — границы: новый индекс не смешивается со старыми страницами); одновременные запросы при
 * пустом мемо делят одно чтение; сбой не запоминается.
 */
@Injectable()
export class SitemapService {
  private readonly boundsMemo = new Map<string, Memo<Bounds>>();
  private readonly pageMemo = new Map<string, Memo<SitemapPage>>();
  private readonly sources: Record<SitemapKind, Source>;

  constructor(
    @Inject(RACES_FOR_SHARING) races: RacesForSharing,
    @Inject(ROUTES_FOR_SHARING) routes: RoutesForSharing,
    @Inject(CALENDAR_FOR_SHARING) calendar: CalendarForSharing,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.sources = {
      race: (afterId, limit) => races.sitemapAfter(afterId, limit),
      season: (afterId, limit) => races.sitemapSeasonsAfter(afterId, limit),
      route: (afterId, limit) => routes.sitemapAfter(afterId, limit),
      calendar: (afterId, limit) => calendar.sitemapAfter(afterId, limit),
    };
  }

  async index(): Promise<SitemapIndex> {
    const bounds = await this.bounds();
    return {
      pages: SITEMAP_KINDS.flatMap((kind) =>
        bounds[kind].map((page, n) => ({
          kind,
          page: n + 1,
          updatedAt: page.updatedAt.toISOString(),
        })),
      ),
    };
  }

  /** Страница `page` (с 1) вида; вне индекса — `null` без чтения коллекции. */
  async page(kind: SitemapKind, page: number): Promise<SitemapPage | null> {
    const pages = (await this.bounds())[kind];
    const bounds = pages[page - 1];
    if (!bounds) return null;
    const final = page === pages.length;
    const key = `${kind}:${bounds.after ?? ''}:${bounds.last}:${final ? 'final' : ''}`;
    return this.remember(this.pageMemo, key, SITEMAP_POLICY.pageMemoMax, () =>
      this.read(kind, bounds, final),
    );
  }

  /** Только для тестов: сбросить мемо (`h.reset()` возвращает часы назад — окно прежнего теста ещё открыто). */
  forget(): void {
    this.boundsMemo.clear();
    this.pageMemo.clear();
  }

  private bounds(): Promise<Bounds> {
    return this.remember(this.boundsMemo, 'index', 1, async () => {
      const scanned = await Promise.all(SITEMAP_KINDS.map((kind) => this.scanBounds(kind)));
      return Object.fromEntries(SITEMAP_KINDS.map((kind, n) => [kind, scanned[n]!])) as Bounds;
    });
  }

  private async scanBounds(kind: SitemapKind): Promise<PageBounds[]> {
    const pages: PageBounds[] = [];
    let pageAfter: string | null = null;
    let count = 0;
    let maxAt: Date | null = null;
    let last: string | null = null;
    for (;;) {
      const rows = await this.sources[kind](last, SITEMAP_POLICY.scanPage);
      for (const row of rows) {
        count += 1;
        last = row.id;
        if (!maxAt || row.updatedAt > maxAt) maxAt = row.updatedAt;
        if (count === SITEMAP_POLICY.pageSize) {
          pages.push({ after: pageAfter, last: row.id, updatedAt: maxAt });
          pageAfter = row.id;
          count = 0;
          maxAt = null;
        }
      }
      if (rows.length < SITEMAP_POLICY.scanPage) break;
    }
    if (count > 0 && last !== null && maxAt)
      pages.push({ after: pageAfter, last, updatedAt: maxAt });
    return pages;
  }

  private async read(kind: SitemapKind, bounds: PageBounds, final: boolean): Promise<SitemapPage> {
    const cap = final ? SITEMAP_POLICY.pageSize : SITEMAP_POLICY.fileUrlMax;
    const items: SitemapPage['items'] = [];
    let after = bounds.after;
    while (items.length < cap) {
      const limit = Math.min(SITEMAP_POLICY.scanPage, cap - items.length);
      const rows = await this.sources[kind](after, limit);
      // uuidv7 — строчные hex: порядок строк JS = порядок `_id` в MongoDB
      const inPage = final ? rows : rows.filter((row) => row.id <= bounds.last);
      items.push(...inPage.map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString() })));
      const tail = rows.at(-1);
      if (!tail || rows.length < limit || (!final && tail.id >= bounds.last)) break;
      after = tail.id;
    }
    return { items };
  }

  private remember<T>(
    pool: Map<string, Memo<T>>,
    key: string,
    max: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = pool.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    pool.delete(key);
    if (pool.size >= max) {
      // старейшая запись — первая (Map хранит порядок вставки)
      const oldest = pool.keys().next().value;
      if (oldest !== undefined) pool.delete(oldest);
    }
    const value = load();
    const memo = { expiresAt: now + SITEMAP_POLICY.memoMs, value };
    pool.set(key, memo);
    value.catch(() => {
      if (pool.get(key) === memo) pool.delete(key);
    });
    return value;
  }
}
