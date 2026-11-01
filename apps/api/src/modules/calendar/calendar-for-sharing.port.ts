/**
 * Порт `calendar` для модуля `sharing` (OG-картинка старта календаря, og-images, через `modules/calendar/index.ts`):
 * публичные факты опубликованного старта и старты, изменившиеся после курсора (пререндер `og.sync`).
 */
export const CALENDAR_FOR_SHARING = Symbol('CALENDAR_FOR_SHARING');

/** Факты карточки — поля публичной страницы старта, без ссылки организатора и описания. */
export interface CalendarOgFacts {
  startId: string;
  title: string;
  /** календарные даты Минска `YYYY-MM-DD`; однодневный — `endsOn: null` */
  startsOn: string;
  endsOn: string | null;
  city: string;
  distancesKm: number[];
}

export interface CalendarForSharing {
  /** Только опубликованный старт; иначе `null`. */
  ogFacts(startId: string): Promise<CalendarOgFacts | null>;
  /** Опубликованные старты, изменившиеся строго после курсора, по `(updatedAt, _id)`, не больше `limit`. */
  ogChanged(
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
  /** Опубликованные старты строго после `afterId` по `_id` ↑, не больше `limit` — карта сайта (sitemap-index). */
  sitemapAfter(afterId: string | null, limit: number): Promise<{ id: string; updatedAt: Date }[]>;
}
