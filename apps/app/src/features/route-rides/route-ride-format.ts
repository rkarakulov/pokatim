import type {
  RouteRideDetail,
  RouteRideLeaderboard,
  RouteRideLeaderboardMe,
  RouteRideLeaderboardRow,
  RouteRidePage,
  RouteRideRow,
  RouteRideSection,
  RouteRideTrack,
} from '@pokatim/contracts';
import { formatElapsed, formatKm, minskDateTime, t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';
import type { Href } from 'expo-router';

import { formatMinskDateTime } from '@/features/devices/format';
import { profileWho } from '@/features/races/participation-format';
import { km } from '@/features/routes/format';
import { formatCountdown } from '@/lib/countdown';
import { formatLocalRange, heroDateText, meta } from '@/lib/minsk-format';

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

/** Строка происхождения (route-rides-03, V5): `auto` — «Проверен автоматически»; ручной и незнакомый — `null`. */
export const routeRideOriginText = (origin: RouteRideDetail['origin']): string | null =>
  origin === 'auto' ? t('routes.rides.result.autoChecked') : null;

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

/** Блок «Участки» (route-rides-05): только с участками в ответе и не во время проверки; пусто — блока нет (RC-1). */
export const routeRideSectionsShown = (detail: RouteRideDetail): boolean =>
  detail.sections.length > 0 && !isPendingCheck(detail.status);

/** «Пройдено участков: 2 из 3» — подсчёт статусов ответа (показ, не результат; RC-3). */
export function routeRideSectionsSummary(sections: readonly RouteRideSection[]): string {
  const passed = sections.filter((section) => section.status === 'passed').length;
  return t('routes.rides.result.sectionsPassed', { passed, count: sections.length });
}

export interface RouteRideSectionView {
  /** «Участок 2 · 10–20 км» */
  title: string;
  /** время — только у `passed` */
  time: string | null;
  /** «Не пройден» / «Статус неизвестен» — когда времени нет */
  status: string | null;
  /** «Лучший» — только по `isBest` сервера */
  best: boolean;
  /** «К лучшему: +0:12» (`passed`, не лучший) или «Лучшее время: 18:04» (`not_passed`) */
  comparison: string | null;
  /** склейка видимых частей — один элемент скринридера */
  a11y: string;
}

const sectionComparison = (section: RouteRideSection, passed: boolean): string | null => {
  if (passed) {
    return section.isBest || section.deltaToBestSec === null
      ? null
      : t('routes.rides.result.toBest', { delta: formatDeltaSec(section.deltaToBestSec) });
  }
  return section.status === 'not_passed' && section.bestElapsedSec !== null
    ? t('routes.rides.result.sectionBest', { time: formatElapsed(section.bestElapsedSec) })
    : null;
};

/**
 * Строка участка: номер — позиция в ответе (сервер отдаёт по `fromM`, клиент не сортирует; RC-8), км — округлением
 * длины маршрута (RC-6). Время, «лучший» и дельта — только сервер (RC-9: «Лучший» — по `isBest`, не по дельте 0);
 * сумма, темп и скорость участка не показываются (у границ края не входят в участки, RC-2).
 */
export function routeRideSectionView(
  section: RouteRideSection,
  index: number,
): RouteRideSectionView {
  const title = t('routes.rides.result.section', {
    n: index + 1,
    from: formatKm(km(section.fromM)),
    to: formatKm(km(section.toM)),
  });
  const time =
    section.status === 'passed' && section.elapsedSec !== null
      ? formatElapsed(section.elapsedSec)
      : null;
  const passed = time !== null;
  const status = time === null ? routeRideStatusPill(section.status).label : null;
  const best = passed && section.isBest;
  const comparison = sectionComparison(section, passed);
  return {
    title,
    time,
    status,
    best,
    comparison,
    a11y: meta([title, time ?? status, best ? t('races.attempt.best') : null, comparison]),
  };
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

/** Полный список «Другие на маршруте» (route-rides-04). */
export const routeRideOthersPath = (routeId: string): Href =>
  `/routes/others/${encodeURIComponent(routeId)}` as Href;

/** Строк таблицы «Другие» на карточке маршрута (смысл — свой, не `VISIBLE_ROWS`; RC-B7). */
export const OTHERS_CARD_ROWS = 5;

/** День заезда (`LocalDate` Минска) без времени суток: «4 октября»; не текущий год и `now = null` — с годом. */
export const rideDayText = (rideDate: string, now: Date | null) =>
  heroDateText(formatLocalRange(rideDate, rideDate, now));

export interface OthersRowView {
  /** своя строка — «Вы», нажатие ведёт к своему заезду */
  own: boolean;
  place: string;
  who: string;
  time: string;
  day: string;
  /** подпись строки без действия */
  a11y: string;
  /** метка ссылки на публичный профиль — только при `riderPublicId` */
  profileA11y: string | null;
  /** метка перехода к своему заезду — только у своей строки */
  ownA11y: string | null;
}

function othersRowView(
  row: { place: number; elapsedSec: number; rideDate: string },
  own: boolean,
  who: string,
  named: string | null,
  now: Date | null,
): OthersRowView {
  const place = String(row.place);
  const time = formatElapsed(row.elapsedSec);
  const day = rideDayText(row.rideDate, now);
  return {
    own,
    place,
    who,
    time,
    day,
    a11y: t('routes.others.rowA11y', { place, who, time, date: day }),
    profileA11y:
      named === null
        ? null
        : t('routes.others.profileA11y', { who: named, place, time, date: day }),
    ownA11y: own ? t('routes.others.ownA11y', { place, time, date: day }) : null,
  };
}

/**
 * Строка таблицы «Другие» (route-rides-04, O3): место, кто, время и день — только из ответа сервера (места и ничьи
 * клиент не считает). Своя — по `rideId` («Вы»); чужая — имя или «Участник».
 */
export function leaderboardRowView(row: RouteRideLeaderboardRow, now: Date | null): OthersRowView {
  const own = row.rideId !== null;
  const who = own ? t('races.results.you') : (row.riderName ?? t('races.results.rider'));
  return othersRowView(row, own, who, profileWho(row, who), now);
}

/** Своя строка вне списка (`me`, O4): «Вы» со своим местом; ссылки на профиль нет. */
export const leaderboardMeView = (me: RouteRideLeaderboardMe, now: Date | null): OthersRowView =>
  othersRowView(me, true, t('races.results.you'), null, now);

/** Своя строка уже в списке (RC-B1): отдельная строка `me` не нужна. */
export const ownInRows = (rows: readonly RouteRideLeaderboardRow[]) =>
  rows.some((row) => row.rideId !== null);

/** Показано строк: `rows` и своя, показанная отдельно (`me` вне `rows`) — число «Показаны лучшие N из M». */
export const othersShown = (board: RouteRideLeaderboard) =>
  board.rows.length + (board.me !== null && !ownInRows(board.rows) ? 1 : 0);

/**
 * Сервер отдал не все строки (RC-B2): `total` включает зрителя — своя строка, показанная отдельно, тоже видна, поэтому
 * «Все (N)» и сноска — только если скрыт кто-то ещё.
 */
export const othersTruncated = (board: RouteRideLeaderboard) => board.total > othersShown(board);
