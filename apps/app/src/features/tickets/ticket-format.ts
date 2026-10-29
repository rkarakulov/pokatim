import {
  TicketCode,
  type AppTicketCategory,
  type MyTicketRef,
  type OgCardKind,
  type TicketEventSummary,
  type TicketView,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

import { groupLabel, tierLabel } from '@/features/races/participation-format';
import { formatDistances, formatMinskDateTime, minskDateTime } from '@/lib/minsk-format';
import type { ShareLinkInput } from '@/lib/share-link';

/**
 * Подписи билета (event-tickets, plan-B §2) — чистые функции. Даты — по Минску с годом (`now = null`): экран билета не
 * рендерит данные на сервере, но текст не зависит от «сейчас» — один вид онлайн и в офлайн-копии. `unknown` (новое
 * значение у старой сборки) — нейтрально: без подписи.
 */

/** «Гонка» / «Старт календаря»; `unknown` — без кикера. */
export function ticketKindLabel(kind: TicketEventSummary['kind']): string | null {
  if (kind === 'race') return t('tickets.kind.race');
  if (kind === 'calendar') return t('tickets.kind.calendar');
  return null;
}

type TicketState = Pick<MyTicketRef, 'status' | 'past'> & {
  checkedInAt?: TicketView['checkedInAt'];
};

/**
 * Статус для плашки: отмена (райдером или события) важнее «прошло»; отмеченный — со временем отметки; `past` —
 * «Событие завершено»; `unknown` — `null` (без плашки).
 */
export function ticketStatus(state: TicketState): { label: string; tone: PillTone } | null {
  switch (state.status) {
    case 'cancelled':
      return { label: t('tickets.status.cancelled'), tone: 'neutral' };
    case 'event_cancelled':
      return { label: t('tickets.status.eventCancelled'), tone: 'error' };
    case 'checked_in':
      return {
        label: state.checkedInAt
          ? t('tickets.status.checkedInAt', {
              time: formatMinskDateTime(state.checkedInAt, null, 'short').full,
            })
          : t('tickets.status.checkedIn'),
        tone: 'success',
      };
    case 'active':
      return state.past
        ? { label: t('tickets.status.past'), tone: 'neutral' }
        : { label: t('tickets.status.active'), tone: 'success' };
    default:
      return null;
  }
}

/** Пояснение вместо QR (`qr: null`): почему кода нет. */
export function qrUnavailableText(state: TicketState): string {
  if (state.status === 'cancelled') return t('tickets.qrUnavailable.cancelled');
  if (state.status === 'event_cancelled') return t('tickets.qrUnavailable.eventCancelled');
  if (state.status === 'checked_in') return t('tickets.qrUnavailable.checkedIn');
  if (state.past) return t('tickets.qrUnavailable.past');
  return t('tickets.qrUnavailable.unknown');
}

/** Категория участника: «Группа» (уровень и группа заявки гонки) или «Дистанция»; нет — `null`. */
export function ticketCategory(
  category: AppTicketCategory,
): { label: string; value: string } | null {
  if (category === null) return null;
  if (category.kind === 'calendar') {
    const distance = category.distanceKm === null ? null : formatDistances([category.distanceKm]);
    return distance ? { label: t('tickets.distance'), value: distance } : null;
  }
  if (category.tier === 'unknown') return null;
  const tier = tierLabel(category.tier);
  const group = category.groupKey;
  const value =
    group === 'overall' || group === 'unknown'
      ? tier
      : t('races.entry.tierGroup', { tier, group: groupLabel(group) });
  return { label: t('tickets.group'), value };
}

/** «Воскресенье, 14 июня 2027, 8:00» и конец («– 14:00» в тот же день, иначе полная дата). */
export function ticketDateLine(event: Pick<TicketEventSummary, 'startsAt' | 'endsAt'>): string {
  const start = formatMinskDateTime(event.startsAt, null);
  if (!event.endsAt) return start.full;
  const end = formatMinskDateTime(event.endsAt, null);
  const sameDay =
    minskDateTime(event.startsAt, null).localDate === minskDateTime(event.endsAt, null).localDate;
  return t('format.range', { from: start.full, to: sameDay ? end.time : end.full });
}

/** Короткая дата строки «Ваши билеты»: «Вс 14 июня 2027, 8:00». */
export const ticketShortDate = (startsAt: string) =>
  formatMinskDateTime(startsAt, null, 'short').full;

/** Запрос для внешних карт (RC-B3): адрес (или место) и город; нет ни адреса, ни места — `null`. */
export function directionsQuery(
  event: Pick<TicketEventSummary, 'address' | 'place' | 'city'>,
): string | null {
  const where = event.address ?? event.place;
  if (!where) return null;
  return event.city && !where.includes(event.city) ? `${where}, ${event.city}` : where;
}

/** Карточка события билета; `unknown` — `null` (кнопки «О событии» нет). */
export function eventPath(event: Pick<TicketEventSummary, 'kind' | 'id'>): string | null {
  if (event.kind === 'race') return `/races/${event.id}`;
  if (event.kind === 'calendar') return `/calendar/${event.id}`;
  return null;
}

/** Вид OG-картинки события («Поделиться» с картинкой файлом); `unknown` — без картинки. */
export function eventOgKind(kind: TicketEventSummary['kind']): OgCardKind | null {
  return kind === 'race' || kind === 'calendar' ? kind : null;
}

/**
 * «Поделиться» (RC-B2): только ссылка на событие и «Я участвую: {событие}, {дата}» — без кода и QR (код — запасной
 * ключ входа, §5.3). Карточки события нет — `null`.
 */
export function ticketShareInput(event: TicketEventSummary): ShareLinkInput | null {
  const path = eventPath(event);
  if (!path) return null;
  return {
    title: event.title,
    text: t('tickets.shareText', {
      event: event.title,
      date: formatMinskDateTime(event.startsAt, null).date,
    }),
    path,
  };
}

/** Код для скринридера — посимвольно («A B C D E 1 2 3 4 5»): слитно его читают словом. */
export const spelledCode = (code: string) => code.split('').join(' ');

/** Событие закончилось: `endsAt`, иначе старт + 12 ч (окно check-in сервера, §5.4). */
export const TICKET_EVENT_DEFAULT_MS = 12 * 3_600_000;
export function eventEndsAtMs(event: Pick<TicketEventSummary, 'startsAt' | 'endsAt'>): number {
  return event.endsAt
    ? Date.parse(event.endsAt)
    : Date.parse(event.startsAt) + TICKET_EVENT_DEFAULT_MS;
}

/** Канонический код из адреса (`XXXXX-XXXXX`, строчные — тоже) или `null` — адрес не код билета. */
export function canonicalTicketCode(raw: unknown): string | null {
  const parsed = TicketCode.safeParse(typeof raw === 'string' ? raw : '');
  return parsed.success ? parsed.data : null;
}
