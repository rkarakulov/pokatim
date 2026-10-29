import type { Job } from 'bullmq';

import { RaceTickets } from '../src/modules/tickets/race-tickets';
import { TicketsEmailProcessor } from '../src/modules/tickets/jobs/tickets-email.processor';
import { TICKETS_ISSUED } from '../src/modules/tickets/tickets.events';
import { ticketsCollections } from '../src/modules/tickets/tickets.collection';
import type { Harness } from './harness';
import { call, outboxEvents } from './identity';
import { panelCall, panelCookie } from './panel';
import { corridorRace, rider } from './results';

/** Коллекции модуля `tickets` тестовой БД. */
export const ticketsDb = (h: Harness) => ticketsCollections(h.db);

/** Очный старт гонки стенда: 24.10 10:00 Минска (окно гонки — 24.10 00:00 … 26.10 23:59). */
export const RACE_START = '2026-10-24T07:00:00Z';
/** Старт календаря стенда: 01.11 10:00 Минска. */
export const CALENDAR_START = new Date('2026-11-01T07:00:00Z');

export const ticketingUrl = (kind: 'race' | 'calendar', id: string, path = 'ticketing') =>
  `/v1/admin/events/${kind}/${id}/${path}`;

/** Админ, сезон, маршрут и опубликованная гонка с коридором (схема `overall`) — заявки принимаются. */
export async function raceWorld(h: Harness) {
  const { admin, raceId } = await corridorRace(h);
  return { admin, raceId };
}

/** Включить билеты гонки (тест знает, что успешно); версия. */
export async function enableRaceTickets(
  h: Harness,
  token: string,
  raceId: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const current = await panelCall(h, token, 'GET', ticketingUrl('race', raceId));
  const res = await panelCall(h, token, 'PUT', ticketingUrl('race', raceId), {
    enabled: true,
    startsAt: RACE_START,
    place: 'Парк Победы',
    address: 'пр. Победителей, 1',
    instructions: 'Приходите за час.',
    version: (current.body as { version: number }).version,
    ...overrides,
  });
  if (res.status !== 200) throw new Error(`билеты: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { version: number }).version;
}

/** Старт календаря через панель (01.11, 10:00 Минска); id. */
export async function calendarStart(
  h: Harness,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await panelCall(h, token, 'POST', '/v1/admin/calendar', {
    title: 'Минский марафон',
    startsOn: '2026-11-01',
    endsOn: null,
    startTime: '10:00',
    discipline: 'road',
    city: 'Минск',
    place: 'Площадь Независимости',
    distancesKm: [10, 42.2],
    registrationUrl: null,
    description: null,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`старт: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

/** Включить регистрацию на старт календаря; версия. */
export async function enableCalendarTickets(
  h: Harness,
  token: string,
  id: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const current = await panelCall(h, token, 'GET', ticketingUrl('calendar', id));
  const res = await panelCall(h, token, 'PUT', ticketingUrl('calendar', id), {
    enabled: true,
    version: (current.body as { version: number }).version,
    ...overrides,
  });
  if (res.status !== 200) throw new Error(`регистрация: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { version: number }).version;
}

export const registrationUrl = (id: string) => `/v1/calendar/${id}/registration`;

/** Регистрация райдера на старт календаря. */
export const registerFor = (
  h: Harness,
  auth: Record<string, string>,
  id: string,
  body: Record<string, unknown> = { distanceKm: 42.2 },
) => call(h, 'POST', registrationUrl(id), body, auth);

export const raceTicket = (h: Harness, auth: Record<string, string>, raceId: string) =>
  call(h, 'GET', `/v1/races/${raceId}/ticket`, undefined, auth);

export const ticketView = (h: Harness, auth: Record<string, string>, code: string) =>
  call(h, 'GET', `/v1/tickets/${code}`, undefined, auth);

/** Сверка всех гонок регламентом (как worker). */
export const reconcileAll = (h: Harness) => h.worker.get(RaceTickets).reconcileAll();

/** События `tickets.issued` outbox. */
export const issuedEvents = async (h: Harness) =>
  (await outboxEvents(h)).filter((event) => event.type === TICKETS_ISSUED);

/** Обработать письма по событиям `tickets.issued` (как worker); итоги задач. */
export async function sendTicketEmails(h: Harness, attemptsMade = 0): Promise<string[]> {
  const processor = h.worker.get(TicketsEmailProcessor);
  const results: string[] = [];
  for (const event of await issuedEvents(h)) {
    const job = {
      name: TICKETS_ISSUED,
      data: { outboxEventId: event._id },
      attemptsMade,
      opts: { attempts: 5 },
    } as unknown as Job;
    results.push(await processor.process(job));
  }
  return results;
}

/** Заявка START (без анкеты Verified, race-results-07); тест знает, что успешно. */
export async function enter(h: Harness, auth: Record<string, string>, raceId: string) {
  const res = await call(h, 'POST', `/v1/races/${raceId}/entry`, { tier: 'start' }, auth);
  if (res.status !== 201) throw new Error(`заявка: ${res.status} ${JSON.stringify(res.body)}`);
}

export { rider };

/** Минимальный PDF (сигнатура `%PDF-`) для материалов PR C. */
export const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'latin1');

/** Ссылка-материал события через панель (тест знает, что успешно); id. */
export async function addLinkMaterial(
  h: Harness,
  token: string,
  kind: 'race' | 'calendar',
  eventId: string,
  title = 'Положение',
): Promise<string> {
  const res = await panelCall(h, token, 'POST', ticketingUrl(kind, eventId, 'materials'), {
    type: 'link',
    title,
    description: null,
    url: 'https://pokatim.by/rules',
  });
  if (res.status !== 201) throw new Error(`материал: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

/** PDF-материал события через панель; id файла. */
export async function addPdfMaterial(
  h: Harness,
  token: string,
  kind: 'race' | 'calendar',
  eventId: string,
  title = 'Схема парковки',
): Promise<string> {
  const query = new URLSearchParams({ type: 'parking', title, fileName: 'parking.pdf' });
  const response = await h.app.inject({
    method: 'POST',
    url: `${ticketingUrl(kind, eventId, 'materials')}/files?${query.toString()}`,
    headers: { 'content-type': 'application/octet-stream', ...panelCookie(token) },
    payload: PDF_BYTES,
  });
  if (response.statusCode !== 201) throw new Error(`PDF: ${response.statusCode} ${response.body}`);
  return (JSON.parse(response.body) as { file: { id: string } }).file.id;
}
