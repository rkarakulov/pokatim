import { type DisputeOutcome, type NotificationKind, PLATFORM_TIME_ZONE } from '@pokatim/contracts';

/**
 * Словарь текстов уведомлений (RC-9, «Тексты v1» `docs/product/notifications.md`). Строки сервера живут в модуле, как
 * письма identity и `error-messages.ts`: api от `@pokatim/i18n` не зависит. Текст рендерится при создании и хранится
 * снимком. Только название гонки или райда, дата, число — без имён и текстов других райдеров (N12). Даты — по Минску.
 */
export type NoticeText =
  | { kind: 'result_counted' | 'result_rejected'; race: string; activityAt: Date }
  | {
      kind:
        | 'protocol_published'
        | 'protocol_disqualified'
        | 'protocol_restored'
        | 'protocol_rechecked'
        | 'dispute_filed'
        | 'dispute_withdrawn'
        | 'dispute_responded';
      race: string;
    }
  | { kind: 'dispute_decided'; race: string; outcome: DisputeOutcome }
  | { kind: 'ride_cancelled' | 'ride_rescheduled'; ride: string; startsAt: Date }
  | { kind: 'ride_joined'; ride: string; goingCount: number }
  | { kind: 'ride_report_resolved'; ride: string };

export interface RenderedText {
  title: string;
  body: string;
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  day: 'numeric',
  month: 'long',
});
const hourMinute = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** «14 июня». */
const day = (at: Date) => dayMonth.format(at);
/** «14 июня, 10:00». */
const dayTime = (at: Date) => `${dayMonth.format(at)}, ${hourMinute.format(at)}`;
/** Название в кавычках «…»: снимок — одна строка. */
const quoted = (name: string) => `«${name.replace(/\s+/g, ' ').trim()}»`;

const OUTCOME: Record<DisputeOutcome, string> = {
  upheld: 'удовлетворён',
  rejected: 'отклонён',
};

const TITLES: Record<NotificationKind, string> = {
  result_counted: 'Результат засчитан',
  result_rejected: 'Результат не засчитан',
  protocol_published: 'Протокол опубликован',
  protocol_disqualified: 'Протокол изменён',
  protocol_restored: 'Протокол изменён',
  protocol_rechecked: 'Протокол пересчитан',
  dispute_filed: 'На ваш результат подан спор',
  dispute_withdrawn: 'Спор отозван',
  dispute_responded: 'Ответ на ваш спор',
  dispute_decided: 'Решение по спору',
  ride_cancelled: 'Райд отменён',
  ride_rescheduled: 'Райд перенесён',
  ride_joined: 'Новый участник',
  ride_report_resolved: 'Жалоба рассмотрена',
};

function bodyOf(input: NoticeText): string {
  switch (input.kind) {
    case 'result_counted':
      return `${quoted(input.race)}: заезд ${day(input.activityAt)} засчитан.`;
    case 'result_rejected':
      return `${quoted(input.race)}: заезд ${day(input.activityAt)} не засчитан. Причина — на карточке гонки.`;
    case 'protocol_published':
      return `${quoted(input.race)}: итоговый протокол готов.`;
    case 'protocol_disqualified':
      return `${quoted(input.race)}: ваш результат снят с протокола.`;
    case 'protocol_restored':
      return `${quoted(input.race)}: ваш результат восстановлен в протоколе.`;
    case 'protocol_rechecked':
      return `${quoted(input.race)}: протокол пересчитан после перепроверки треков.`;
    case 'dispute_filed':
      return `${quoted(input.race)}: вы можете ответить до решения модератора.`;
    case 'dispute_withdrawn':
      return `${quoted(input.race)}: спор на ваш результат отозван.`;
    case 'dispute_responded':
      return `${quoted(input.race)}: райдер ответил. Решение примет модератор.`;
    case 'dispute_decided':
      return `${quoted(input.race)}: спор рассмотрен — ${OUTCOME[input.outcome]}.`;
    case 'ride_cancelled':
      return `${quoted(input.ride)} ${dayTime(input.startsAt)} отменён.`;
    case 'ride_rescheduled':
      return `${quoted(input.ride)}: новое время или место старта — ${dayTime(input.startsAt)}.`;
    case 'ride_joined':
      return `${quoted(input.ride)}: участников — ${input.goingCount}.`;
    case 'ride_report_resolved':
      return `Модератор рассмотрел вашу жалобу на райд ${quoted(input.ride)}. Спасибо.`;
  }
}

/** Заголовок и текст уведомления по таблице продукта. */
export function renderNotification(input: NoticeText): RenderedText {
  return { title: TITLES[input.kind], body: bodyOf(input) };
}

/** Русская форма числа: `one` (1, 21, 101), `few` (2–4, 22–24), `many` (0, 5–20, 11–14, 25…). */
function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Сводка отложенных push (N7): «У вас N новых уведомлений» с формами числа (RC-7). */
export function renderPushSummary(count: number): RenderedText {
  const noun = ruPlural(count, 'новое уведомление', 'новых уведомления', 'новых уведомлений');
  return { title: 'Покатим', body: `У вас ${count} ${noun}.` };
}
