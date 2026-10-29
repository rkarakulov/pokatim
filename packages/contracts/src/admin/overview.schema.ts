import { z } from 'zod';

import { Uuid } from '../common.ts';
import { LocalDate } from '../time.ts';

const Count = z.number().int().nonnegative();

/** Гонка с открытым окном: активные заявки и загруженные попытки (кроме снятых участником). */
export const PanelOverviewRace = z.object({
  id: Uuid,
  title: z.string(),
  windowEndsAt: z.iso.datetime(),
  participants: Count,
  attempts: Count,
});
export type PanelOverviewRace = z.infer<typeof PanelOverviewRace>;

/** Ближайший старт календаря: даты — календарные Минска. */
export const PanelOverviewCalendarStart = z.object({
  id: Uuid,
  title: z.string(),
  startsOn: LocalDate,
  endsOn: LocalDate.nullable(),
  city: z.string(),
});
export type PanelOverviewCalendarStart = z.infer<typeof PanelOverviewCalendarStart>;

/**
 * `GET /v1/admin/overview` (admin-overview): «Обзор» панели. Блоки и карточки — по правам сотрудника; нет права — поля
 * нет (не `0`). Гонки организатора — только свои. Счётчики — те же очереди, что в разделах.
 */
export const PanelOverview = z.object({
  attention: z.object({
    /** `disputes.read` — открытые споры */
    disputes: z.object({ open: Count }).optional(),
    /**
     * `races.read` — гонки, ждущие публикации протокола (`awaiting` — все); готовность и сумма невыполненных пунктов
     * чек-листа — по `checked` недавно закрывшимся (`checked < awaiting` — не по всем)
     */
    protocols: z
      .object({ awaiting: Count, checked: Count, ready: Count, blockers: Count })
      .optional(),
    /** `rides.moderate` — кофе-райды с открытыми жалобами */
    rides: z.object({ reported: Count }).optional(),
    /** `routes.moderate` — заявки в каталог и маршруты райдеров с жалобами */
    riderRoutes: z.object({ pending: Count, reported: Count }).optional(),
    /** `profiles.moderate` — профили с открытыми жалобами */
    riderProfiles: z.object({ reported: Count }).optional(),
    /** `platform.stats` — удаления аккаунтов, не завершённые за сутки */
    accountDeletions: z.object({ stuck: Count }).optional(),
  }),
  /** `races.read` — гонки с открытым окном (`racesTotal` — всего, `races` — первые) и ближайшие старты календаря */
  live: z
    .object({
      racesTotal: Count,
      races: z.array(PanelOverviewRace),
      calendar: z.array(PanelOverviewCalendarStart),
    })
    .optional(),
  /** `platform.stats` — за последние 7 суток: регистрации и загрузки; активные (предстоящие) кофе-райды */
  kpi: z.object({ newUsers: Count, uploads: Count, activeRides: Count }).optional(),
});
export type PanelOverview = z.infer<typeof PanelOverview>;
