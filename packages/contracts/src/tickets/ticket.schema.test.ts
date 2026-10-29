import { describe, expect, it } from 'vitest';

import {
  CalendarRegistrationRequest,
  EventTicketingPublic,
  formatTicketCode,
  MyTickets,
  normalizeTicketCode,
  TICKET_EVENT_KINDS,
  TICKET_STATUSES,
  TicketCode,
  TicketQrPayload,
  TicketView,
} from './ticket.schema.ts';
import {
  AdminEventParams,
  CheckInRequest,
  CheckInView,
  EventTicketingUpdate,
  EventTicketsQuery,
} from './ticketing-admin.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const event = {
  kind: 'race',
  id: ID,
  title: 'Минское кольцо',
  startsAt: '2026-10-24T07:00:00.000Z',
  endsAt: null,
  place: 'Парк Победы',
  address: null,
  city: null,
};
const QR = `PKT1.${'a'.repeat(43)}`;

describe('билеты: код и QR (event-tickets)', () => {
  it('справочники — только в конец', () => {
    expect(TICKET_EVENT_KINDS).toEqual(['race', 'calendar']);
    expect(TICKET_STATUSES).toEqual(['active', 'checked_in', 'cancelled', 'event_cancelled']);
  });

  it('код: дефис, строчные, I/L/O — к каноническому виду (Crockford)', () => {
    expect(normalizeTicketCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(TicketCode.parse('0o1il-23456')).toBe('00111' + '23456');
    expect(TicketCode.parse(' 7XK2M-9PQRT ')).toBe('7XK2M9PQRT');
    expect(formatTicketCode('7XK2M9PQRT')).toBe('7XK2M-9PQRT');
  });

  it('код: длина, U и чужие символы — ошибка', () => {
    for (const bad of [
      'ABCDE',
      'ABCDEFGHJKM',
      'ABCDEFGHJU',
      'ABCDE_FGHJ',
      '{"$ne":1}',
      'x'.repeat(40),
    ]) {
      expect(TicketCode.safeParse(bad).success, bad).toBe(false);
    }
    expect(TicketCode.safeParse({ $ne: null }).success).toBe(false);
  });

  it('QR: только PKT1.<43 символа base64url>', () => {
    expect(TicketQrPayload.parse(QR)).toBe(QR);
    expect(TicketQrPayload.safeParse(`PKT1.${'a'.repeat(42)}`).success).toBe(false);
    expect(TicketQrPayload.safeParse(`PKT2.${'a'.repeat(43)}`).success).toBe(false);
    expect(TicketQrPayload.safeParse(`PKT1.${'a'.repeat(42)}=`).success).toBe(false);
  });
});

describe('билеты: ответы приложения', () => {
  it('TicketView: незнакомые статус, вид события и группа — unknown (tolerantEnum)', () => {
    const view = TicketView.parse({
      code: '7XK2M9PQRT',
      status: 'transferred',
      past: false,
      event: { ...event, kind: 'ride' },
      participantName: 'Анна',
      category: { kind: 'race', tier: 'verified', groupKey: 'm_60p' },
      qr: QR,
      instructions: null,
      checkedInAt: null,
    });
    expect(view.status).toBe('unknown');
    expect(view.event.kind).toBe('unknown');
    expect(view.category).toEqual({ kind: 'race', tier: 'verified', groupKey: 'unknown' });
  });

  it('MyTickets: две группы', () => {
    const ref = { code: '7XK2M9PQRT', status: 'active', past: false, event };
    expect(MyTickets.parse({ upcoming: [ref], past: [] }).upcoming).toHaveLength(1);
  });

  it('EventTicketingPublic: выключено — один ключ; включено — сводка', () => {
    expect(EventTicketingPublic.parse({ enabled: false })).toEqual({ enabled: false });
    const on = {
      enabled: true,
      startsAt: event.startsAt,
      endsAt: null,
      place: null,
      address: null,
      capacity: 100,
      seatsLeft: 3,
      registrationOpen: true,
      distancesKm: [10, 42.2],
    };
    expect(EventTicketingPublic.parse(on)).toEqual(on);
  });

  it('CalendarRegistrationRequest: пусто или дистанция; лишние ключи — ошибка', () => {
    expect(CalendarRegistrationRequest.parse({})).toEqual({});
    expect(CalendarRegistrationRequest.parse({ distanceKm: 42.2 })).toEqual({ distanceKm: 42.2 });
    expect(CalendarRegistrationRequest.safeParse({ distanceKm: -1 }).success).toBe(false);
    expect(CalendarRegistrationRequest.safeParse({ userId: ID }).success).toBe(false);
  });
});

describe('билеты: панель', () => {
  it('AdminEventParams: вид события строгий, id — uuid', () => {
    expect(AdminEventParams.parse({ kind: 'calendar', eventId: ID })).toEqual({
      kind: 'calendar',
      eventId: ID,
    });
    expect(AdminEventParams.safeParse({ kind: 'ride', eventId: ID }).success).toBe(false);
    expect(AdminEventParams.safeParse({ kind: 'race', eventId: 'x' }).success).toBe(false);
  });

  it('EventTicketingUpdate: enabled и version обязательны; пустой текст — null; лишние ключи — ошибка', () => {
    expect(
      EventTicketingUpdate.parse({
        enabled: true,
        startsAt: '2026-10-24T07:00:00Z',
        place: ' Парк ',
        address: '',
        version: 0,
      }),
    ).toEqual({
      enabled: true,
      startsAt: '2026-10-24T07:00:00Z',
      place: 'Парк',
      address: null,
      version: 0,
    });
    expect(EventTicketingUpdate.safeParse({ version: 0 }).success).toBe(false);
    expect(EventTicketingUpdate.safeParse({ enabled: true }).success).toBe(false);
    expect(
      EventTicketingUpdate.safeParse({ enabled: true, version: 0, registeredCount: 5 }).success,
    ).toBe(false);
    expect(EventTicketingUpdate.safeParse({ enabled: true, version: 0, capacity: 0 }).success).toBe(
      false,
    );
    expect(
      EventTicketingUpdate.safeParse({ enabled: true, version: 0, instructions: 'я'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  it('CheckInRequest: ровно одно поле — qr или code', () => {
    expect(CheckInRequest.parse({ qr: QR })).toEqual({ qr: QR });
    expect(CheckInRequest.parse({ code: '7xk2m-9pqrt' })).toEqual({ code: '7XK2M9PQRT' });
    expect(CheckInRequest.safeParse({ qr: QR, code: '7XK2M9PQRT' }).success).toBe(false);
    expect(CheckInRequest.safeParse({}).success).toBe(false);
  });

  it('CheckInView: строгий исход', () => {
    const ticket = {
      code: '7XK2M9PQRT',
      status: 'checked_in',
      participantName: 'Участник',
      category: null,
      event,
      checkedInAt: event.startsAt,
      checkedInBy: 'Сотрудник',
    };
    expect(CheckInView.parse({ outcome: 'already_checked_in', ticket }).outcome).toBe(
      'already_checked_in',
    );
    expect(CheckInView.safeParse({ outcome: 'other', ticket }).success).toBe(false);
  });

  it('EventTicketsQuery: limit по умолчанию 50, курсор — uuid', () => {
    expect(EventTicketsQuery.parse({})).toEqual({ limit: 50 });
    expect(EventTicketsQuery.safeParse({ cursor: 'x' }).success).toBe(false);
    expect(EventTicketsQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});
