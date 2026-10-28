import { addLocalDays, minskToday, utcToMinskWallTime, type RaceCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import {
  domainLabel,
  formatDistances,
  formatLocalRange,
  heroDateText,
  meta,
  minskDateTime,
  type HeroDate,
} from '@/lib/minsk-format';

/**
 * Подписи гонки — чистые функции. Фаза — только с сервера (`race.phase`), клиент её не вычисляет; «сейчас» нужен лишь
 * для «сегодня / завтра», года и «протокол ожидается». `now === null` (SSR и первый рендер публичного экрана) — без
 * «сегодня / завтра», даты с годом: HTML сервера совпадает с гидрацией.
 */

/** Окно гонки по Минску: «4–12» + «октября». */
export function formatRaceWindow(startsAt: string, endsAt: string, now: Date | null): HeroDate {
  return formatLocalRange(
    utcToMinskWallTime(startsAt).slice(0, 10),
    utcToMinskWallTime(endsAt).slice(0, 10),
    now,
  );
}

/** «Окно открыто до …» / «…закрывается сегодня / завтра в …» (сегодня и завтра — только при известном `now`). */
function openLine(race: RaceCard, now: Date | null, dateNow: Date | null = now): string {
  const closes = minskDateTime(race.windowEndsAt, dateNow);
  if (now !== null) {
    const today = minskToday(now);
    if (closes.localDate === today) {
      return t('races.window.closesToday', { closeTime: closes.time });
    }
    if (closes.localDate === addLocalDays(today, 1)) {
      return t('races.window.closesTomorrow', { closeTime: closes.time });
    }
  }
  return t('races.window.openUntil', { closes: closes.date, closeTime: closes.time });
}

/**
 * Полная строка окна (герой Главной и вкладки): `upcoming` — открытие и закрытие, `open` — до закрытия (сегодня /
 * завтра по Минску — отдельно); остальные и `'unknown'` — без строки (R9).
 */
export function raceHeroLine(race: RaceCard, now: Date | null): string | null {
  if (race.phase === 'upcoming') {
    const opens = minskDateTime(race.windowStartsAt, now);
    const closes = minskDateTime(race.windowEndsAt, now);
    return t('races.window.upcoming', {
      opens: opens.date,
      openTime: opens.time,
      closes: closes.date,
      closeTime: closes.time,
    });
  }
  return race.phase === 'open' ? openLine(race, now) : null;
}

/**
 * Строка окна карточки списка (§7): `upcoming` — «Окно откроется …», `open` — как герой, `closed` — «Протокол —
 * {дата}», а после плановой даты по часам клиента — «Протокол ожидается» (Q9; подпись, не фаза). `cancelled` (баннер)
 * и `'unknown'` — без строки. `datesWithYear` — публичный экран: даты всегда с годом (не зависят от «сейчас»).
 */
export function raceCardLine(
  race: RaceCard,
  now: Date | null,
  datesWithYear = false,
): string | null {
  const dateNow = datesWithYear ? null : now;
  switch (race.phase) {
    case 'upcoming': {
      const opens = minskDateTime(race.windowStartsAt, dateNow);
      return t('races.window.opens', { opens: opens.date, openTime: opens.time });
    }
    case 'open':
      return openLine(race, now, dateNow);
    case 'closed':
      return now !== null && Date.parse(race.protocolPlannedAt) <= now.getTime()
        ? t('races.window.closedAwaiting')
        : t('races.window.closedProtocol', {
            date: minskDateTime(race.protocolPlannedAt, dateNow).date,
          });
    default:
      return null;
  }
}

/** Покрытия строчными через « · »; `'unknown'` — пропускаются. */
function surfacesText(race: RaceCard): string {
  return meta(
    race.surfaces.map(
      (surface) => domainLabel('domain.surface', surface)?.toLocaleLowerCase('ru') ?? null,
    ),
  );
}

/** «Класс «Гравий» · покрытие: гравий · асфальт»; неизвестные класс/покрытия — без своей части. */
export function raceClassSurfaces(race: RaceCard): string {
  const bikeClass = domainLabel('domain.bikeClass', race.bikeClass);
  const surfaces = surfacesText(race);
  if (bikeClass && surfaces) return t('races.classSurfaces', { bikeClass, surfaces });
  if (bikeClass) return t('races.classOnly', { bikeClass });
  return surfaces ? t('races.surfacesOnly', { surfaces }) : '';
}

/** «Гонка отменена. Причина: {причина}.» (как превью панели, Q13); `'unknown'` — без причины (R9). */
export function cancelMessage(reason: RaceCard['cancelReason']): string {
  const label = reason ? domainLabel('domain.raceCancelReason', reason) : null;
  return label ? t('races.cancelled', { reason: label }) : t('races.cancelledNoReason');
}

/** Мета героя вкладки: «62 км · класс «Гравий». Окно: 4–12 октября, до 23:59.» */
export function raceHeroMeta(race: RaceCard, now: Date | null): string {
  const values = {
    distance: formatDistances([race.distanceKm]) ?? '',
    window: heroDateText(formatRaceWindow(race.windowStartsAt, race.windowEndsAt, now)),
    closeTime: minskDateTime(race.windowEndsAt, now).time,
  };
  const bikeClass = domainLabel('domain.bikeClass', race.bikeClass);
  return bikeClass
    ? t('races.heroMeta', { ...values, bikeClass })
    : t('races.heroMetaNoClass', values);
}

/** Мета героя Главной: «62 км · Гравий». */
export function raceMeta(race: RaceCard): string {
  return meta([
    formatDistances([race.distanceKm]),
    ...race.surfaces.map((surface) => domainLabel('domain.surface', surface)),
  ]);
}

/** Описание публичной карточки (мета, OG): «4–12 октября 2026 · Гравий · 62 км» — даты с годом, без ПДн. */
export function raceShareDescription(race: RaceCard): string {
  return meta([
    heroDateText(formatRaceWindow(race.windowStartsAt, race.windowEndsAt, null)),
    domainLabel('domain.bikeClass', race.bikeClass),
    formatDistances([race.distanceKm]),
  ]);
}

/** Длительность «1:02:05» (h:mm:ss) — общий код `@pokatim/i18n`; цифры — стилями с `tabularNums`. */
export { formatElapsed } from '@pokatim/i18n';
