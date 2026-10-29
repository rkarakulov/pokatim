import { ERASURE_STUCK_MS } from '../identity';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Пределы «Обзора» панели (admin-overview). */
export const OVERVIEW_POLICY = {
  /** KPI — за последние 7 суток (скользящее окно от `now`). */
  kpiPeriodMs: 7 * DAY_MS,
  /** Удаление аккаунта «зависло» — порог identity, общий с экраном сбоев удаления (erasure-failures). */
  stuckDeletionMs: ERASURE_STUCK_MS,
  /** Гонок на фазу: с открытым окном — в списке, ждущих протокола — в расчёте блокеров (гонок немного; защита). */
  racesLimit: 20,
  /** Ближайших стартов календаря. */
  calendarLimit: 5,
} as const;
