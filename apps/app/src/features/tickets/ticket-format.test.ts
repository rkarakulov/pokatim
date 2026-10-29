/// <reference types="jest" />
import { calendarTicket, raceTicket } from './fixtures';
import {
  directionsQuery,
  eventEndsAtMs,
  eventOgKind,
  eventPath,
  qrUnavailableText,
  spelledCode,
  ticketCategory,
  ticketDateLine,
  ticketKindLabel,
  ticketShareInput,
  ticketStatus,
} from './ticket-format';

describe('подписи билета', () => {
  it('тип события; unknown — без кикера', () => {
    expect(ticketKindLabel('race')).toBe('Гонка');
    expect(ticketKindLabel('calendar')).toBe('Старт календаря');
    expect(ticketKindLabel('unknown')).toBeNull();
  });

  it('статусы: активен, прошёл, отмечен со временем (Минск), отменён, событие отменено, unknown', () => {
    expect(ticketStatus({ status: 'active', past: false })).toEqual({
      label: 'Активен',
      tone: 'success',
    });
    expect(ticketStatus({ status: 'active', past: true })?.label).toBe('Событие завершено');
    // 7:42 по Минску
    expect(
      ticketStatus({ status: 'checked_in', past: false, checkedInAt: '2027-06-14T04:42:00Z' })
        ?.label,
    ).toBe('Отмечен Пн 14 июня 2027, 7:42');
    expect(ticketStatus({ status: 'checked_in', past: false, checkedInAt: null })?.label).toBe(
      'Отмечен',
    );
    expect(ticketStatus({ status: 'cancelled', past: true })?.label).toBe('Отменён');
    expect(ticketStatus({ status: 'event_cancelled', past: false })?.label).toBe(
      'Событие отменено',
    );
    expect(ticketStatus({ status: 'unknown', past: false })).toBeNull();
  });

  it('пояснение вместо QR — по статусу', () => {
    expect(qrUnavailableText({ status: 'cancelled', past: false })).toBe(
      'QR недоступен: билет отменён.',
    );
    expect(qrUnavailableText({ status: 'event_cancelled', past: false })).toBe(
      'QR недоступен: событие отменено.',
    );
    expect(qrUnavailableText({ status: 'active', past: true })).toBe(
      'QR недоступен: событие завершено.',
    );
    expect(qrUnavailableText({ status: 'checked_in', past: false })).toBe(
      'Вы уже отмечены на входе.',
    );
  });

  it('категория: группа гонки, общий зачёт — только уровень, дистанция календаря, нет — null', () => {
    expect(ticketCategory(raceTicket.category)).toEqual({
      label: 'Группа',
      value: 'Verified · Мужчины до 40',
    });
    expect(ticketCategory({ kind: 'race', tier: 'start', groupKey: 'overall' })).toEqual({
      label: 'Группа',
      value: 'START',
    });
    expect(ticketCategory(calendarTicket.category)).toEqual({
      label: 'Дистанция',
      value: '100 км',
    });
    expect(ticketCategory({ kind: 'calendar', distanceKm: null })).toBeNull();
    expect(ticketCategory({ kind: 'race', tier: 'unknown', groupKey: 'unknown' })).toBeNull();
    expect(ticketCategory(null)).toBeNull();
  });

  it('дата по Минску с годом (TZ теста ≠ UTC): конец в тот же день — только время', () => {
    expect(ticketDateLine(raceTicket.event)).toBe('Понедельник, 14 июня 2027, 8:00–14:00');
    expect(ticketDateLine(calendarTicket.event)).toBe('Воскресенье, 20 июня 2027, 8:00');
    expect(
      ticketDateLine({ startsAt: '2027-06-14T05:00:00Z', endsAt: '2027-06-15T05:00:00Z' }),
    ).toBe('Понедельник, 14 июня 2027, 8:00–Вторник, 15 июня 2027, 8:00');
  });

  it('карты: адрес и город, иначе место; ничего — null', () => {
    expect(directionsQuery(raceTicket.event)).toBe('пр. Победителей, 1, Минск');
    expect(directionsQuery({ address: null, place: 'Стела', city: null })).toBe('Стела');
    expect(directionsQuery({ address: null, place: null, city: 'Минск' })).toBeNull();
  });

  it('карточка события по типу; unknown — null', () => {
    expect(eventPath(raceTicket.event)).toBe(`/races/${raceTicket.event.id}`);
    expect(eventPath(calendarTicket.event)).toBe(`/calendar/${calendarTicket.event.id}`);
    expect(eventPath({ kind: 'unknown', id: raceTicket.event.id })).toBeNull();
  });

  it('«Поделиться» — ссылка на событие и текст без кода и QR (RC-B2)', () => {
    const input = ticketShareInput(raceTicket.event);
    expect(input).toEqual({
      title: 'Гонка «Минское кольцо»',
      text: 'Я участвую: Гонка «Минское кольцо», Понедельник, 14 июня 2027',
      path: `/races/${raceTicket.event.id}`,
    });
    expect(JSON.stringify(input)).not.toContain(raceTicket.code);
    expect(JSON.stringify(input)).not.toContain('PKT1');
  });

  it('вид OG-картинки события — гонка и старт календаря; незнакомый вид — без картинки', () => {
    expect(eventOgKind('race')).toBe('race');
    expect(eventOgKind('calendar')).toBe('calendar');
    expect(eventOgKind('unknown')).toBeNull();
  });

  it('код для скринридера — посимвольно; конец события — endsAt или старт + 12 ч', () => {
    expect(spelledCode('ABC12')).toBe('A B C 1 2');
    expect(eventEndsAtMs(raceTicket.event)).toBe(Date.parse('2027-06-14T11:00:00.000Z'));
    expect(eventEndsAtMs(calendarTicket.event)).toBe(Date.parse('2027-06-20T17:00:00.000Z'));
  });
});
