import { Inject, Injectable } from '@nestjs/common';
import {
  SITEMAP_KINDS,
  type SitemapIndex,
  type SitemapKind,
  type SitemapPage,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { ChangedRow, IdRange } from '../../changed-since';
import { CALENDAR_FOR_SHARING, type CalendarForSharing } from '../calendar';
import { RACES_FOR_SHARING, type RacesForSharing } from '../races';
import { ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { SITEMAP_POLICY } from './sharing.policy';

/** Строки страницы при сборке индекса: строго после `after` (`null` — с начала) до `last` включительно. */
interface PageBounds {
  after: string | null;
  last: string;
  count: number;
  /** максимум `updatedAt` строк */
  maxAt: Date;
  /** `lastmod` страницы в индексе */
  lastmod: Date;
}
type Bounds = Record<SitemapKind, PageBounds[]>;
type Source = (range: IdRange, limit: number) => Promise<ChangedRow[]>;

/** Поколение индекса: границы и мемо страниц живут и истекают вместе. */
interface Generation {
  bounds: Bounds;
  pages: Map<string, Promise<SitemapPage>>;
}

/**
 * Карта сайта (landing-seo, sitemap-index): публичные гонки, сезоны, маршруты каталога и старты календаря — порты
 * владельцев, keyset по `_id` ↑ (uuidv7: правка объекта не переносит его между страницами, новые — в конец). Кофе-райдов
 * и профилей нет — их страницы `noindex`.
 *
 * Индекс — полный проход по каждому виду, в памяти только границы страниц по `pageSize` (O(страниц)). Страница `n` —
 * `(after, last]` границ индекса (не больше `fileUrlMax`: uuidv7 случаен внутри миллисекунды, вставка внутрь диапазона
 * возможна и не теряется); последняя — ещё и новые после `last`, пока страница не больше `pageSize`.
 *
 * `lastmod` страницы — максимум `updatedAt` её строк; если состав страницы (`after`, `last`, число строк) изменился
 * относительно прошлого поколения (публикация старого черновика, снятие, сдвиг границ) — момент сборки индекса. Первое
 * поколение процесса прошлого не знает — максимум `updatedAt`.
 *
 * Поколение (границы и страницы) запоминается в процессе на `memoMs`; страницы — внутри поколения (не больше
 * `pageMemoMax`) и истекают вместе с ним. Одновременные запросы делят одно чтение; сбой не запоминается.
 */
@Injectable()
export class SitemapService {
  private generation: { expiresAt: number; value: Promise<Generation> } | null = null;
  /** границы последнего собранного поколения — для `lastmod` следующего */
  private previous: Bounds | null = null;
  private readonly sources: Record<SitemapKind, Source>;

  constructor(
    @Inject(RACES_FOR_SHARING) races: RacesForSharing,
    @Inject(ROUTES_FOR_SHARING) routes: RoutesForSharing,
    @Inject(CALENDAR_FOR_SHARING) calendar: CalendarForSharing,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.sources = {
      race: (range, limit) => races.sitemapRange(range, limit),
      season: (range, limit) => races.sitemapSeasonsRange(range, limit),
      route: (range, limit) => routes.sitemapRange(range, limit),
      calendar: (range, limit) => calendar.sitemapRange(range, limit),
    };
  }

  async index(): Promise<SitemapIndex> {
    const { bounds } = await this.current();
    return {
      pages: SITEMAP_KINDS.flatMap((kind) =>
        bounds[kind].map((page, n) => ({
          kind,
          page: n + 1,
          updatedAt: page.lastmod.toISOString(),
        })),
      ),
    };
  }

  /** Страница `page` (с 1) вида; вне индекса — `null` без чтения коллекции. */
  async page(kind: SitemapKind, page: number): Promise<SitemapPage | null> {
    const generation = await this.current();
    const pages = generation.bounds[kind];
    const bounds = pages[page - 1];
    if (!bounds) return null;
    const key = `${kind}:${page}`;
    const hit = generation.pages.get(key);
    if (hit) return hit;
    if (generation.pages.size >= SITEMAP_POLICY.pageMemoMax) {
      // старейшая запись — первая (Map хранит порядок вставки)
      const oldest = generation.pages.keys().next().value;
      if (oldest !== undefined) generation.pages.delete(oldest);
    }
    const value = this.read(kind, bounds, page === pages.length);
    generation.pages.set(key, value);
    value.catch(() => {
      if (generation.pages.get(key) === value) generation.pages.delete(key);
    });
    return value;
  }

  /** Только для тестов: сбросить мемо (`h.reset()` возвращает часы назад — окно прежнего теста ещё открыто). */
  forget(): void {
    this.generation = null;
    this.previous = null;
  }

  private current(): Promise<Generation> {
    const now = this.clock.now();
    const memo = this.generation;
    if (memo && memo.expiresAt > now.getTime()) return memo.value;
    const value = this.build(now);
    const next = { expiresAt: now.getTime() + SITEMAP_POLICY.memoMs, value };
    this.generation = next;
    value.catch(() => {
      if (this.generation === next) this.generation = null;
    });
    return value;
  }

  private async build(builtAt: Date): Promise<Generation> {
    const scanned = await Promise.all(SITEMAP_KINDS.map((kind) => this.scanBounds(kind)));
    const previous = this.previous;
    const bounds = Object.fromEntries(
      SITEMAP_KINDS.map((kind, n) => [
        kind,
        scanned[n]!.map((page, i) => ({
          ...page,
          lastmod: lastmodOf(page, previous?.[kind][i], previous !== null, builtAt),
        })),
      ]),
    ) as Bounds;
    this.previous = bounds;
    return { bounds, pages: new Map() };
  }

  private async scanBounds(kind: SitemapKind): Promise<Omit<PageBounds, 'lastmod'>[]> {
    const pages: Omit<PageBounds, 'lastmod'>[] = [];
    let pageAfter: string | null = null;
    let count = 0;
    let maxAt: Date | null = null;
    let last: string | null = null;
    for (;;) {
      const rows = await this.sources[kind]({ after: last, until: null }, SITEMAP_POLICY.scanPage);
      for (const row of rows) {
        count += 1;
        last = row.id;
        if (!maxAt || row.updatedAt > maxAt) maxAt = row.updatedAt;
        if (count === SITEMAP_POLICY.pageSize) {
          pages.push({ after: pageAfter, last: row.id, count, maxAt });
          pageAfter = row.id;
          count = 0;
          maxAt = null;
        }
      }
      if (rows.length < SITEMAP_POLICY.scanPage) break;
    }
    if (count > 0 && last !== null && maxAt) pages.push({ after: pageAfter, last, count, maxAt });
    return pages;
  }

  /**
   * Строки `(after, last]` (не больше `fileUrlMax`, без чтения за `last`); у последней страницы — затем новые после
   * `last`, пока строк не больше `pageSize` (строки своих границ не вытесняются).
   */
  private async read(kind: SitemapKind, bounds: PageBounds, final: boolean): Promise<SitemapPage> {
    const items: SitemapPage['items'] = [];
    const collect = async (until: string | null, cap: number) => {
      let after = until === null ? bounds.last : bounds.after;
      while (items.length < cap) {
        const limit = Math.min(SITEMAP_POLICY.scanPage, cap - items.length);
        const rows = await this.sources[kind]({ after, until }, limit);
        items.push(...rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString() })));
        const tail = rows.at(-1);
        if (!tail || rows.length < limit) break;
        after = tail.id;
      }
    };
    await collect(bounds.last, SITEMAP_POLICY.fileUrlMax);
    if (final) await collect(null, SITEMAP_POLICY.pageSize);
    return { items };
  }
}

/**
 * `lastmod` страницы: состав не изменился относительно прошлого поколения — прежний (или новее по строкам); изменился —
 * момент сборки; прошлого поколения нет (первое в процессе) — максимум `updatedAt` строк.
 */
function lastmodOf(
  page: Omit<PageBounds, 'lastmod'>,
  before: PageBounds | undefined,
  known: boolean,
  builtAt: Date,
): Date {
  if (!known) return page.maxAt;
  const same =
    before !== undefined &&
    before.after === page.after &&
    before.last === page.last &&
    before.count === page.count;
  if (!same) return builtAt > page.maxAt ? builtAt : page.maxAt;
  return before.lastmod > page.maxAt ? before.lastmod : page.maxAt;
}
