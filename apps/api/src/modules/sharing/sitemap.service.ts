import { Inject, Injectable } from '@nestjs/common';
import type { SitemapEntries, SitemapEntry, SitemapKind } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { RACES_FOR_SHARING, type RacesForSharing } from '../races';
import { OgCardInputs } from './og-card.inputs';
import { SITEMAP_POLICY } from './sharing.policy';

/** Виды с курсором `ogChanged` порта владельца (только публичное: опубликованное, в каталоге). */
const SCANNED_KINDS = ['race', 'route', 'calendar'] as const satisfies readonly SitemapKind[];

/**
 * Карта сайта (landing-seo): публичные гонки, маршруты каталога, старты календаря (порты владельцев через
 * `OgCardInputs.changed`, постранично до `kindLimit`) и сезоны (`RacesForSharing.sitemapSeasons`). Кофе-райдов и
 * профилей нет — их страницы `noindex`. Ответ запоминается в процессе на `memoMs`; одновременные запросы при пустом
 * мемо делят один сбор; сбой не запоминается.
 */
@Injectable()
export class SitemapService {
  private memo: { expiresAt: number; value: Promise<SitemapEntries> } | null = null;

  constructor(
    private readonly inputs: OgCardInputs,
    @Inject(RACES_FOR_SHARING) private readonly races: RacesForSharing,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  entries(): Promise<SitemapEntries> {
    const now = this.clock.now().getTime();
    if (this.memo && this.memo.expiresAt > now) return this.memo.value;
    const value = this.collect();
    const memo = { expiresAt: now + SITEMAP_POLICY.memoMs, value };
    this.memo = memo;
    value.catch(() => {
      if (this.memo === memo) this.memo = null;
    });
    return value;
  }

  /** Только для тестов: сбросить мемо (`h.reset()` возвращает часы назад — окно прежнего теста ещё открыто). */
  forget(): void {
    this.memo = null;
  }

  private async collect(): Promise<SitemapEntries> {
    const items: SitemapEntry[] = [];
    for (const kind of SCANNED_KINDS) items.push(...(await this.scan(kind)));
    const seasons = await this.races.sitemapSeasons();
    items.push(...seasons.map((season) => entry('season', season)));
    return { items };
  }

  private async scan(kind: (typeof SCANNED_KINDS)[number]): Promise<SitemapEntry[]> {
    const items: SitemapEntry[] = [];
    let after: { at: Date; id: string } | null = null;
    while (items.length < SITEMAP_POLICY.kindLimit) {
      const limit = Math.min(SITEMAP_POLICY.scanPage, SITEMAP_POLICY.kindLimit - items.length);
      const rows = await this.inputs.changed(kind, after, limit);
      items.push(...rows.map((row) => entry(kind, row)));
      const last = rows.at(-1);
      if (!last || rows.length < limit) break;
      after = { at: last.updatedAt, id: last.id };
    }
    return items;
  }
}

const entry = (kind: SitemapKind, row: { id: string; updatedAt: Date }): SitemapEntry => ({
  kind,
  id: row.id,
  updatedAt: row.updatedAt.toISOString(),
});
