import { describe, expect, it } from 'vitest';

import { type NoticeText, renderNotification, renderPushSummary } from './notification-texts';

const RACE = 'Гран-при «Минское море»';
const RIDE = 'Кофе-райд на Минское море';
const ROUTE = 'Вокруг Минского моря';
/** 14 июня 2027, 10:00 по Минску (UTC+3). */
const AT = new Date('2027-06-14T07:00:00Z');

/** Таблица «Тексты v1» `docs/product/notifications.md` — построчно. */
const TABLE: [string, NoticeText, string, string][] = [
  [
    'Результат засчитан',
    { kind: 'result_counted', race: RACE, activityAt: AT },
    'Результат засчитан',
    `«${RACE}»: заезд 14 июня засчитан.`,
  ],
  [
    'Результат не засчитан',
    { kind: 'result_rejected', race: RACE, activityAt: AT },
    'Результат не засчитан',
    `«${RACE}»: заезд 14 июня не засчитан. Причина — на карточке гонки.`,
  ],
  [
    'Протокол опубликован',
    { kind: 'protocol_published', race: RACE },
    'Протокол опубликован',
    `«${RACE}»: итоговый протокол готов.`,
  ],
  [
    'Дисквалификация',
    { kind: 'protocol_disqualified', race: RACE },
    'Протокол изменён',
    `«${RACE}»: ваш результат снят с протокола.`,
  ],
  [
    'Отмена дисквалификации',
    { kind: 'protocol_restored', race: RACE },
    'Протокол изменён',
    `«${RACE}»: ваш результат восстановлен в протоколе.`,
  ],
  [
    'Перепроверка',
    { kind: 'protocol_rechecked', race: RACE },
    'Протокол пересчитан',
    `«${RACE}»: протокол пересчитан после перепроверки треков.`,
  ],
  [
    'Подан спор',
    { kind: 'dispute_filed', race: RACE },
    'На ваш результат подан спор',
    `«${RACE}»: вы можете ответить до решения модератора.`,
  ],
  [
    'Спор отозван',
    { kind: 'dispute_withdrawn', race: RACE },
    'Спор отозван',
    `«${RACE}»: спор на ваш результат отозван.`,
  ],
  [
    'Ответ на спор',
    { kind: 'dispute_responded', race: RACE },
    'Ответ на ваш спор',
    `«${RACE}»: райдер ответил. Решение примет модератор.`,
  ],
  [
    'Решение по спору — удовлетворён',
    { kind: 'dispute_decided', race: RACE, outcome: 'upheld' },
    'Решение по спору',
    `«${RACE}»: спор рассмотрен — удовлетворён.`,
  ],
  [
    'Решение по спору — отклонён',
    { kind: 'dispute_decided', race: RACE, outcome: 'rejected' },
    'Решение по спору',
    `«${RACE}»: спор рассмотрен — отклонён.`,
  ],
  [
    'Райд отменён',
    { kind: 'ride_cancelled', ride: RIDE, startsAt: AT },
    'Райд отменён',
    `«${RIDE}» 14 июня, 10:00 отменён.`,
  ],
  [
    'Райд перенесён',
    { kind: 'ride_rescheduled', ride: RIDE, startsAt: AT },
    'Райд перенесён',
    `«${RIDE}»: новое время или место старта — 14 июня, 10:00.`,
  ],
  [
    'Новый участник',
    { kind: 'ride_joined', ride: RIDE, goingCount: 7 },
    'Новый участник',
    `«${RIDE}»: участников — 7.`,
  ],
  [
    'Жалоба рассмотрена',
    { kind: 'ride_report_resolved', ride: RIDE },
    'Жалоба рассмотрена',
    `Модератор рассмотрел вашу жалобу на райд «${RIDE}». Спасибо.`,
  ],
  [
    'Маршрут опубликован',
    { kind: 'route_published', route: ROUTE },
    'Маршрут опубликован',
    `«${ROUTE}» теперь в каталоге маршрутов.`,
  ],
  [
    'Маршрут отклонён',
    { kind: 'route_rejected', route: ROUTE, reason: 'impassable' },
    'Маршрут отклонён',
    `«${ROUTE}» не опубликован. Причина — непроезжий или неточный.`,
  ],
  [
    'Напоминание о событии',
    {
      kind: 'event_reminder',
      event: RACE,
      startsAt: AT,
      place: 'Парк Победы',
      text: 'Возьмите паспорт.\nСтарт у фонтана.',
    },
    'Скоро старт',
    `«${RACE}» — 14 июня, 10:00, Парк Победы.\nВозьмите паспорт.\nСтарт у фонтана.`,
  ],
];

describe('renderNotification: таблица «Тексты v1»', () => {
  it.each(TABLE)('%s', (_name, input, title, body) => {
    expect(renderNotification(input)).toEqual({ title, body });
  });

  it('каждый kind контракта покрыт строкой таблицы', () => {
    expect(new Set(TABLE.map(([, input]) => input.kind)).size).toBe(17);
  });

  it('даты — по Минску, не по поясу процесса: 23:30 UTC — уже следующий день', () => {
    const lateUtc = new Date('2026-10-22T23:30:00Z');
    expect(
      renderNotification({ kind: 'result_counted', race: 'Г', activityAt: lateUtc }).body,
    ).toBe('«Г»: заезд 23 октября засчитан.');
    expect(renderNotification({ kind: 'ride_cancelled', ride: 'Р', startsAt: lateUtc }).body).toBe(
      '«Р» 23 октября, 02:30 отменён.',
    );
  });

  it('напоминание без места — без запятой после времени', () => {
    expect(
      renderNotification({
        kind: 'event_reminder',
        event: 'Э',
        startsAt: AT,
        place: null,
        text: 'Т',
      }).body,
    ).toBe('«Э» — 14 июня, 10:00.\nТ');
  });

  it('пробелы и переводы строк в названии схлопываются (снимок — одна строка)', () => {
    expect(renderNotification({ kind: 'protocol_published', race: '  Гонка \n  дня ' }).body).toBe(
      '«Гонка дня»: итоговый протокол готов.',
    );
  });
});

describe('route_rejected: подпись каждой причины (без комментария модератора, N12)', () => {
  it.each([
    ['dangerous', 'Причина — опасный маршрут.'],
    ['impassable', 'Причина — непроезжий или неточный.'],
    ['duplicate', 'Причина — такой маршрут уже есть в каталоге.'],
    ['bad_title', 'Причина — неподходящее название.'],
    ['not_cycling', 'Причина — не велосипедный маршрут.'],
    ['other', 'Подробности — в карточке маршрута.'],
  ] as const)('%s', (reason, tail) => {
    expect(renderNotification({ kind: 'route_rejected', route: 'М', reason }).body).toBe(
      `«М» не опубликован. ${tail}`,
    );
  });
});

describe('renderPushSummary: сводка тихих часов с формами числа (RC-7)', () => {
  it.each([
    [1, 'У вас 1 новое уведомление.'],
    [2, 'У вас 2 новых уведомления.'],
    [4, 'У вас 4 новых уведомления.'],
    [5, 'У вас 5 новых уведомлений.'],
    [11, 'У вас 11 новых уведомлений.'],
    [14, 'У вас 14 новых уведомлений.'],
    [21, 'У вас 21 новое уведомление.'],
    [22, 'У вас 22 новых уведомления.'],
    [25, 'У вас 25 новых уведомлений.'],
    [111, 'У вас 111 новых уведомлений.'],
    [101, 'У вас 101 новое уведомление.'],
  ])('%i', (count, body) => {
    expect(renderPushSummary(count)).toEqual({ title: 'Покатим', body });
  });
});
