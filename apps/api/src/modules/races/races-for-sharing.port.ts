import type { BikeClass } from '@pokatim/contracts';

/**
 * Порт `races` для модуля `sharing` (OG-картинка гонки, og-images, через `modules/races/index.ts`): публичные факты
 * опубликованной гонки и гонки, изменившиеся после курсора (пререндер `og.sync`, карта сайта), и сезоны (карта сайта). `sharing` коллекций `races` не
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

export interface RacesForSharing {
  /** Только опубликованная гонка; черновик, отменённая, неизвестная — `null`. */
  ogFacts(raceId: string): Promise<RaceOgFacts | null>;
  /** Опубликованные гонки, изменившиеся строго после курсора, по `(updatedAt, _id)`, не больше `limit`. */
  ogChanged(
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
  /** Все сезоны (публичны, их десятки) — карта сайта (landing-seo). */
  sitemapSeasons(): Promise<{ id: string; updatedAt: Date }[]>;
}
