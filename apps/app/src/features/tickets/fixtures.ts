import type { MyTicketRef, TicketView } from '@pokatim/contracts';

/** Фикстуры билетов для тестов (не импортируются кодом приложения). */
export const TICKET_CODE = 'ABCDE12345';
export const QR = `PKT1.${'aB3_-'.repeat(8)}xyz`;
export const RACE_ID = '0190a6f4-0000-7000-8000-0000000000a1';
export const START_ID = '0190a6f4-0000-7000-8000-0000000000c1';

export const raceTicket: TicketView = {
  code: TICKET_CODE,
  status: 'active',
  past: false,
  event: {
    kind: 'race',
    id: RACE_ID,
    title: 'Гонка «Минское кольцо»',
    // 14 июня 2027, 8:00–14:00 по Минску
    startsAt: '2027-06-14T05:00:00.000Z',
    endsAt: '2027-06-14T11:00:00.000Z',
    place: 'Стела',
    address: 'пр. Победителей, 1',
    city: 'Минск',
  },
  participantName: 'Иван К.',
  category: { kind: 'race', tier: 'verified', groupKey: 'm_u40' },
  qr: QR,
  instructions: 'Возьмите шлем.\nСбор в 7:30.',
  checkedInAt: null,
};

export const calendarTicket: TicketView = {
  ...raceTicket,
  code: 'FGHJK67890',
  event: {
    kind: 'calendar',
    id: START_ID,
    title: 'Минская сотка',
    startsAt: '2027-06-20T05:00:00.000Z',
    endsAt: null,
    place: null,
    address: null,
    city: 'Минск',
  },
  category: { kind: 'calendar', distanceKm: 100 },
};

export const ticketRef = (view: TicketView): MyTicketRef => ({
  code: view.code,
  status: view.status,
  past: view.past,
  event: view.event,
});
