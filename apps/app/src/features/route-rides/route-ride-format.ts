import type {
  RouteRideDetail,
  RouteRidePage,
  RouteRideRow,
  RouteRideTrack,
} from '@pokatim/contracts';
import { formatElapsed, minskDateTime, t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';
import type { Href } from 'expo-router';

import { formatMinskDateTime } from '@/features/devices/format';
import { formatCountdown } from '@/lib/countdown';
import { meta } from '@/lib/minsk-format';

/**
 * Заезд по маршруту (route-rides-02) — чистая логика показа. Вердикт, время, «лучший» и дельты — только с сервера
 * (`AGENTS.md` §4.1): клиент выбирает тексты и тоны и не считает разницу. `'unknown'` (сервер новее) — нейтрально.
 */

type Status = RouteRideDetail['status'];
type Reason = RouteRideDetail['reason'];
type Failure = RouteRideDetail['failure'];
type Source = RouteRideDetail['activity']['source'];
type Marks = RouteRideTrack['marks'];

/** Строк в блоке «Мои заезды» до «Показать все». */
export const VISIBLE_ROWS = 5;

/** Проверка ещё идёт: экран и блок опрашивают сервер. */
export const isPendingCheck = (status: Status) => status === 'queued' || status === 'checking';

const STATUS_TONES = {
  queued: 'neutral',
  checking: 'warning',
  passed: 'success',
  not_passed: 'error',
  failed: 'error',
  unknown: 'neutral',
} as const satisfies Record<Status, PillTone>;

/** Пилюля статуса заезда. */
export const routeRideStatusPill = (status: Status): { label: string; tone: PillTone } => ({
  label: t(`routes.rides.status.${status}`),
  tone: STATUS_TONES[status],
});

/** Причина «Не пройден» — тексты гонок; нет или незнакомая — без строки (пилюля уже говорит «Не пройден», RC-8). */
export const routeRideReasonText = (reason: Reason): string | null =>
  reason === null || reason === 'unknown' ? null : t(`races.attempt.reason.${reason}`);

/** Текст сбоя проверки; нет кода — общий. */
export const routeRideFailureText = (failure: Failure): string =>
  t(`routes.rides.failure.${failure ?? 'unknown'}`);

/** Источник заезда; незнакомый — «Файл». */
export const routeRideSourceLabel = (source: Source): string =>
  t(`tracks.source.${source === 'unknown' ? 'upload' : source}`);

/** «Заездов: N · лучший 2:04:37» / «Заездов: N»; заездов нет — `null` (подсказка вместо сводки). */
export function routeRidesSummary(summary: RouteRidePage['summary']): string | null {
  if (summary.count === 0) return null;
  return summary.best
    ? t('routes.rides.summary', {
        count: summary.count,
        time: formatElapsed(summary.best.elapsedSec),
      })
    : t('routes.rides.summaryNoBest', { count: summary.count });
}

export interface RouteRideRowView {
  pill: { label: string; tone: PillTone };
  /** «Лучший» — только у пройденного лучшего */
  best: boolean;
  /** время — только у пройденного */
  time: string | null;
  /** дата (после монтирования) · источник */
  meta: string;
  a11y: string;
}

/** Строка блока «Мои заезды». `now = null` (SSR, до монтирования) — без даты. */
export function routeRideRowView(row: RouteRideRow, now: Date | null): RouteRideRowView {
  const passed = row.status === 'passed';
  const pill = routeRideStatusPill(row.status);
  const best = passed && row.isBest;
  const time = passed && row.elapsedSec !== null ? formatElapsed(row.elapsedSec) : null;
  const rowMeta = meta([
    now === null ? null : formatMinskDateTime(row.activity.startedAt, now),
    routeRideSourceLabel(row.activity.source),
  ]);
  return {
    pill,
    best,
    time,
    meta: rowMeta,
    a11y: meta([pill.label, best ? t('races.attempt.best') : null, time, rowMeta]),
  };
}

/** Дельта со знаком сервера: «+0:42», «−1:05» (U+2212), 0 — «0:00» (RC-7). */
export function formatDeltaSec(sec: number): string {
  const value = formatCountdown(Math.abs(sec));
  if (sec > 0) return `+${value}`;
  if (sec < 0) return `−${value}`;
  return value;
}

/** Строки сравнения со своими заездами (R2): только по ответу сервера. */
export function routeRideComparisonLines(detail: RouteRideDetail, now: Date | null): string[] {
  const { comparison } = detail;
  const date = (iso: string) => minskDateTime(iso, now).date;
  if (detail.status !== 'passed') {
    return comparison.best
      ? [
          t('routes.rides.result.best', {
            time: formatElapsed(comparison.best.elapsedSec),
            date: date(comparison.best.rideStartedAt),
          }),
        ]
      : [];
  }
  const lines: string[] = [];
  if (comparison.isBest) lines.push(t('routes.rides.result.isBest'));
  else if (comparison.deltaToBestSec !== null) {
    lines.push(
      t('routes.rides.result.toBest', { delta: formatDeltaSec(comparison.deltaToBestSec) }),
    );
  }
  if (comparison.previous && comparison.deltaToPreviousSec !== null) {
    lines.push(
      t('routes.rides.result.toPrevious', {
        delta: formatDeltaSec(comparison.deltaToPreviousSec),
        date: date(comparison.previous.rideStartedAt),
      }),
    );
  }
  return lines;
}

/**
 * Текстовая альтернатива трека под картой (RC-9): метров схода в детали нет. Проверка идёт или разметка `pending` —
 * «проверяется»; не пройден — «Где сход», если участки есть (причина — в вердикте экрана, второй раз видимым текстом не
 * повторяется; в подпись карты её добавляет `RouteRideMap`); разметка недоступна — отдельная строка.
 */
export function routeRideTrackLines(
  detail: RouteRideDetail,
  marks: Marks,
  offRuns: number,
): string[] {
  if (marks === 'pending' || isPendingCheck(detail.status)) {
    return [t('races.detail.myTrack.pending')];
  }
  const lines: string[] = [];
  if (detail.status === 'not_passed' && marks === 'ready' && offRuns > 0) {
    lines.push(t('races.detail.myTrack.whereOff'));
  }
  if (marks === 'unavailable') lines.push(t('routes.rides.track.unavailable'));
  return lines;
}

const mineQuery = (mine: boolean) => (mine ? '?mine=1' : '');

/** Выбор своего заезда (A3); `?mine=1` — свой маршрут (A5). */
export const routeRidePickPath = (routeId: string, mine: boolean): Href =>
  `/routes/pick/${encodeURIComponent(routeId)}${mineQuery(mine)}` as Href;

/** Результат заезда (A4). */
export const routeRidePath = (routeId: string, rideId: string, mine: boolean): Href =>
  `/routes/rides/${encodeURIComponent(routeId)}/${encodeURIComponent(rideId)}${mineQuery(mine)}` as Href;

/** Карточка маршрута: свой — «Мой маршрут», иначе каталог. */
export const routeCardPath = (routeId: string, mine: boolean): Href =>
  (mine
    ? `/routes/mine/${encodeURIComponent(routeId)}`
    : `/routes/${encodeURIComponent(routeId)}`) as Href;
