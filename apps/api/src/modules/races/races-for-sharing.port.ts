import type { BikeClass } from '@pokatim/contracts';

/**
 * Порт `races` для модуля `sharing` (OG-картинка гонки, og-images, через `modules/races/index.ts`): публичные факты
 * опубликованной гонки и гонки, изменившиеся после курсора (пререндер `og.sync`, карта сайта), сезоны (карта сайта) и
 * факты OG-картинки сезона с «живыми» сезонами для `og.sync` (og-rider-season-dark). `sharing` коллекций `races` не
 * читает; линию гонки берёт сам через `ROUTE_GEOMETRY` (`routes`).
 */
export const RACES_FOR_SHARING = Symbol('RACES_FOR_SHARING');

/** Факты карточки — поля публичной страницы гонки, без владельца и описания. */
export interface RaceOgFacts {
  raceId: string;
  title: string;
  windowStartsAt: Date;
  windowEndsAt: Date;
  distanceKm: number;
  bikeClass: BikeClass;
  /** маршрут коридора (линия показа — как на странице); гонка-анонс — `null` */
  routeId: string | null;
}

/** Факты OG-картинки сезона — поля публичной страницы сезона (все сезоны публичны), без лидеров и имён. */
export interface SeasonOgFacts {
  seasonId: string;
  /** название сезона (`name`) */
  title: string;
  /** даты Минска включительно */
  startsOn: string;
  endsOn: string;
  /** опубликованные гонки сезона (без черновиков и отменённых) */
  raceCount: number;
}

export interface RacesForSharing {
  /** Только опубликованная гонка; черновик, отменённая, неизвестная — `null`. */
  ogFacts(raceId: string): Promise<RaceOgFacts | null>;
  /** Опубликованные гонки, изменившиеся строго после курсора, по `(updatedAt, _id)`, не больше `limit`. */
  ogChanged(
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
  /** Факты картинки сезона; неизвестный — `null`. */
  seasonOgFacts(seasonId: string): Promise<SeasonOgFacts | null>;
  /**
   * Id «живых» сезонов (`endsOn ≥ sinceLocalDate`, дата Минска) по `_id` — пререндер `og.sync` полным просмотром
   * каждый прогон, без курсора: число гонок сезона меняется без `updatedAt` сезона (RC-2a).
   */
  liveSeasonIds(sinceLocalDate: string): Promise<string[]>;
  /**
   * Опубликованные гонки по `_id` ↑ строго после `after` до `until` включительно (`null` — без границы), не больше
   * `limit` — карта сайта (sitemap-index).
   */
  sitemapRange(
    range: { after: string | null; until: string | null },
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
  /** Сезоны (все публичны) — то же, что `sitemapRange`. */
  sitemapSeasonsRange(
    range: { after: string | null; until: string | null },
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
}
