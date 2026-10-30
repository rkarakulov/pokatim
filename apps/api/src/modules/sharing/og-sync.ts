import { Inject, Injectable, Logger } from '@nestjs/common';
import { minskToday, OG_BRAND } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { OgCardCache } from './og-card.cache';
import { OG_THEME_ID, OgCardInputs, type OgSyncKind } from './og-card.inputs';
import { OgCardQueue } from './og-card.queue';
import { OG_CARD_POLICY, OG_CURSOR_KINDS, ogPrerenderable } from './sharing.policy';

const DAY_MS = 86_400_000;

/** Итог прогона `og.sync`. */
export interface OgSyncRun {
  /** курсоры сброшены: сменилась тема OG или версия рендера — полный проход */
  reset: boolean;
  /** бренд-картинка поставлена в рендер */
  brand: boolean;
  scanned: Record<OgSyncKind, number>;
  enqueued: number;
  failedKinds: OgSyncKind[];
}

/** Отметка полного прохода: тема и версия рендера. */
export const ogSweepMark = () => `${OG_THEME_ID}:${OG_CARD_POLICY.renderVersion}`;

/**
 * Пререндер OG-картинок (og-images, D3, DV-1 — без outbox): по каждому виду — публичные объекты, изменившиеся после
 * курсора `(updatedAt, _id)` в Redis; «живым» без PNG текущего хэша ставится рендер (`og-card.render`, NX). Пачка
 * ограничена (`syncScanLimit` строк вида, `syncRenderLimit` постановок за прогон) — курсор на последней обработанной
 * строке, остаток — следующим прогоном. Смена темы или `renderVersion` — курсоры сброшены, полный проход. Сбой строки —
 * лог и пропуск; сбой чтения вида — курсор вида не двигается, остальные идут, прогон падает (повтор — следующим).
 * Сезоны — без курсора: каждый прогон смотрит все «живые» (`endsOn` не раньше `seasonDays` назад, RC-2a), число гонок
 * сезона меняется без `updatedAt` сезона. Профили райдеров не пререндерятся (самолечение). Рендера здесь нет.
 */
@Injectable()
export class OgSync {
  private readonly logger = new Logger(OgSync.name);

  constructor(
    private readonly inputs: OgCardInputs,
    private readonly cache: OgCardCache,
    private readonly queue: OgCardQueue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(): Promise<OgSyncRun> {
    const now = this.clock.now();
    const mark = ogSweepMark();
    const reset = (await this.cache.sweep()) !== mark;
    if (reset) {
      await this.cache.resetCursors();
      await this.cache.setSweep(mark);
    }

    let enqueued = 0;
    const brand = this.inputs.resolveBrand();
    let brandQueued = false;
    if (!(await this.cache.hasPng(brand.hash))) {
      brandQueued = await this.queue.enqueue({
        kind: OG_BRAND.kind,
        id: OG_BRAND.id,
        hash: brand.hash,
      });
      if (brandQueued) enqueued += 1;
    }

    const scanned = { race: 0, ride: 0, route: 0, calendar: 0, season: 0 } satisfies Record<
      OgSyncKind,
      number
    >;
    const failedKinds: OgSyncKind[] = [];
    for (const kind of OG_CURSOR_KINDS) {
      if (enqueued >= OG_CARD_POLICY.syncRenderLimit) break;
      try {
        const rows = await this.inputs.changed(
          kind,
          await this.cache.cursor(kind),
          OG_CARD_POLICY.syncScanLimit,
        );
        let last: { at: Date; id: string } | null = null;
        for (const row of rows) {
          if (enqueued >= OG_CARD_POLICY.syncRenderLimit) break;
          scanned[kind] += 1;
          if (await this.prerender(kind, row.id, now)) enqueued += 1;
          last = { at: row.updatedAt, id: row.id };
        }
        if (last) await this.cache.setCursor(kind, last);
      } catch (error) {
        failedKinds.push(kind);
        const reason = error instanceof Error ? error.name : 'unknown';
        this.logger.warn(`og.sync_failed kind=${kind} (${reason})`);
      }
    }

    if (enqueued < OG_CARD_POLICY.syncRenderLimit) {
      try {
        const since = minskToday(
          new Date(now.getTime() - OG_CARD_POLICY.prerenderWindow.seasonDays * DAY_MS),
        );
        for (const id of await this.inputs.liveSeasonIds(since)) {
          if (enqueued >= OG_CARD_POLICY.syncRenderLimit) break;
          scanned.season += 1;
          if (await this.prerender('season', id, now)) enqueued += 1;
        }
      } catch (error) {
        failedKinds.push('season');
        const reason = error instanceof Error ? error.name : 'unknown';
        this.logger.warn(`og.sync_failed kind=season (${reason})`);
      }
    }

    const run: OgSyncRun = { reset, brand: brandQueued, scanned, enqueued, failedKinds };
    if (reset || enqueued > 0) {
      this.logger.log(
        `og.sync reset=${reset} enqueued=${enqueued} scanned=${JSON.stringify(scanned)}`,
      );
    }
    if (failedKinds.length > 0) throw new Error(`og.sync failed: ${failedKinds.join(',')}`);
    return run;
  }

  /**
   * Пререндер одной строки: `true` — рендер поставлен. Сбой строки — лог без названий и пропуск: «ядовитая» строка не
   * держит курсор вида (ревью F3); картинка объекта догонит самолечением.
   */
  private async prerender(kind: OgSyncKind, id: string, now: Date): Promise<boolean> {
    try {
      const resolved = await this.inputs.resolve(kind, id);
      return (
        resolved !== null &&
        ogPrerenderable(resolved.input, now) &&
        !(await this.cache.hasPng(resolved.hash)) &&
        (await this.queue.enqueue({ kind, id, hash: resolved.hash }))
      );
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`og.sync_row_failed kind=${kind} id=${id} (${reason})`);
      return false;
    }
  }
}
