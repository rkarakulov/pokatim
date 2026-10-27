import type { MyRoute } from '@pokatim/contracts';
import { RACE_TITLE_MAX_LENGTH, RouteTitle } from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

import { minskDateTime } from '@/lib/minsk-format';

import { routeStats } from './format';

/**
 * Название по умолчанию — имя файла без расширения (routes-02, RC-6): управляющие символы и переводы строк →
 * пробел, пробелы схлопнуты, обрезка до 120 символов (как `RouteTitle`).
 */
export function defaultRouteTitle(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return (
    base
      // eslint-disable-next-line no-control-regex -- управляющие символы имени файла
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, RACE_TITLE_MAX_LENGTH)
      .trim()
  );
}

/** Статус необработанного маршрута для `Pill`: готовый — `null`; отказ — причина; незнакомое — нейтральный текст. */
export function myRouteStatus(route: MyRoute): { label: string; tone: PillTone } | null {
  if (route.status === 'ready') return null;
  if (route.status === 'processing') {
    return { label: t('routes.mine.status.processing'), tone: 'neutral' };
  }
  const failure =
    route.status === 'failed' && route.failure !== null && route.failure !== 'unknown'
      ? (`routes.mine.failure.${route.failure}` as MessageKey)
      : 'routes.mine.status.unknown';
  return { label: t(failure), tone: 'error' };
}

/** «42 км · набор 310 м · петля» — только у готового маршрута. */
export function myRouteStats(route: MyRoute): string | null {
  if (route.status !== 'ready' || route.distanceM === null) return null;
  return routeStats({
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    isLoop: route.isLoop === true,
  });
}

/** Дата загрузки по Минску с годом: «27 октября 2026». */
export const myRouteUploadedAt = (route: MyRoute) => minskDateTime(route.createdAt, null).date;

const TITLE_ERRORS = {
  REQUIRED: 'routes.mine.titleError.REQUIRED',
  TOO_SHORT: 'routes.mine.titleError.TOO_SHORT',
  TOO_LONG: 'routes.mine.titleError.TOO_LONG',
  INVALID: 'routes.mine.titleError.INVALID',
} as const satisfies Record<string, MessageKey>;

const isTitleErrorCode = (code: string): code is keyof typeof TITLE_ERRORS => code in TITLE_ERRORS;

/** Ошибка названия до отправки (загрузка и «Переименовать»: та же схема, что у сервера); `undefined` — годится. */
export function routeTitleError(title: string): string | undefined {
  const parsed = RouteTitle.safeParse(title);
  if (parsed.success) return undefined;
  const code = parsed.error.issues[0]?.message ?? 'INVALID';
  return t(TITLE_ERRORS[isTitleErrorCode(code) ? code : 'INVALID']);
}
