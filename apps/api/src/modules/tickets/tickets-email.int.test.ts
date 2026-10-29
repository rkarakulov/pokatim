import { MyTicketRef } from '@pokatim/contracts';
import { DelayedError, type Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { collections } from '../../../test/identity';
import {
  calendarStart,
  enableCalendarTickets,
  enableRaceTickets,
  enter,
  issuedEvents,
  raceTicket,
  raceWorld,
  registerFor,
  rider,
  sendTicketEmails,
  ticketsDb,
} from '../../../test/tickets';
import { IdentityAccounts } from '../identity';
import { TicketsEmailProcessor } from './jobs/tickets-email.processor';
import { TicketEvents } from './ticket-events';
import { TICKETS_ISSUED } from './tickets.events';

/**
 * Письмо «Вы зарегистрированы» (AC7, RC-T11): содержимое, кнопка только при `APP_WEB_ORIGIN`, без QR и токена, одно
 * письмо на билет, удалённому — `skipped`, сбой SMTP — `pending`, последняя попытка — `failed`.
 */
const ORIGIN = 'https://pokatim.example';
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ APP_WEB_ORIGIN: ORIGIN });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

async function raceWithTicket() {
  const { admin, raceId } = await raceWorld(h);
  await enableRaceTickets(h, admin.token, raceId);
  const who = await rider(h, 'a@example.com');
  await enter(h, who.auth, raceId);
  const { code } = MyTicketRef.parse((await raceTicket(h, who.auth, raceId)).body);
  return { admin, who, code };
}

describe('письмо билета (AC7)', () => {
  it('тема, событие, дата Минска, место, категория, код, кнопка на /tickets/<код>; без PKT1 и токена', async () => {
    const { code } = await raceWithTicket();
    expect(await sendTicketEmails(h)).toEqual(['sent']);
    expect(h.mailer.sent).toHaveLength(1);
    const mail = h.mailer.sent[0]!;
    expect(mail).toMatchObject({
      to: 'a@example.com',
      subject: 'Вы зарегистрированы: Минское кольцо',
    });
    expect(mail.text).toContain('24 октября 2026 г. в 10:00 по минскому времени');
    expect(mail.text).toContain('Где: Парк Победы, пр. Победителей, 1');
    expect(mail.text).toContain('Группа: ');
    expect(mail.text).toContain(`Код билета: ${code.slice(0, 5)}-${code.slice(5)}`);
    expect(mail.text).toContain('Приходите за час.');
    expect(mail.html).toContain(`href="${ORIGIN}/tickets/${code}"`);
    for (const body of [mail.text, mail.html]) expect(body).not.toContain('PKT1');
    const doc = await ticketsDb(h).tickets.findOne({ code });
    expect(doc?.email).toMatchObject({ state: 'sent', claimedUntil: null });
    expect(doc?.email.sentAt).toBeInstanceOf(Date);
  });

  it('повтор задачи — одно письмо', async () => {
    await raceWithTicket();
    await sendTicketEmails(h);
    expect(await sendTicketEmails(h)).toEqual(['skipped']);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('удалённый аккаунт (адрес стёрт) — skipped без письма', async () => {
    const { who } = await raceWithTicket();
    await collections(h).users.updateOne(
      { _id: who.userId },
      { $set: { deletedAt: h.clock.now() } },
    );
    expect(await sendTicketEmails(h)).toEqual(['skipped']);
    expect(h.mailer.sent).toHaveLength(0);
    expect((await ticketsDb(h).tickets.findOne({}))?.email.state).toBe('skipped');
  });

  it('сбой SMTP — pending и ретрай; последняя попытка — failed', async () => {
    await raceWithTicket();
    h.mailer.failNext();
    await expect(sendTicketEmails(h)).rejects.toThrow();
    expect((await ticketsDb(h).tickets.findOne({}))?.email.state).toBe('pending');
    h.mailer.failNext();
    await expect(sendTicketEmails(h, 4)).rejects.toThrow();
    expect((await ticketsDb(h).tickets.findOne({}))?.email.state).toBe('failed');
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('календарь: дистанция; регистрация — одно событие на билет', async () => {
    const { admin } = await raceWithTicket();
    const id = await calendarStart(h, admin.token);
    await enableCalendarTickets(h, admin.token, id);
    const b = await rider(h, 'b@example.com');
    await registerFor(h, b.auth, id);
    expect(await issuedEvents(h)).toHaveLength(2);
    await sendTicketEmails(h);
    const mail = h.mailer.sent.find((sent) => sent.to === 'b@example.com');
    expect(mail?.subject).toBe('Вы зарегистрированы: Минский марафон');
    expect(mail?.text).toContain('Дистанция: 42,2 км');
    expect(mail?.text).toContain('Где: Площадь Независимости, Минск');
  });
});

describe('сбои после захвата и чужой захват (ревью pass 1, HIGH-1)', () => {
  it('чтение события упало — захват снят (pending), следующая попытка отправляет', async () => {
    await raceWithTicket();
    vi.spyOn(h.worker.get(TicketEvents), 'resolve').mockRejectedValueOnce(new Error('db down'));
    await expect(sendTicketEmails(h)).rejects.toThrow('db down');
    expect((await ticketsDb(h).tickets.findOne({}))?.email).toMatchObject({
      state: 'pending',
      claimedUntil: null,
    });
    expect(await sendTicketEmails(h, 1)).toEqual(['sent']);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it('адрес не прочитан на последней попытке — failed', async () => {
    await raceWithTicket();
    vi.spyOn(h.worker.get(IdentityAccounts), 'emailsOf').mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(sendTicketEmails(h, 4)).rejects.toThrow('db down');
    expect((await ticketsDb(h).tickets.findOne({}))?.email.state).toBe('failed');
  });

  it('чужой живой захват — задача отложена до конца захвата, попытка не тратится', async () => {
    await raceWithTicket();
    const until = new Date(h.clock.now().getTime() + 60_000);
    await ticketsDb(h).tickets.updateOne(
      {},
      { $set: { 'email.state': 'sending', 'email.claimedUntil': until } },
    );
    const [event] = await issuedEvents(h);
    const moveToDelayed = vi.fn(() => Promise.resolve());
    const job = {
      name: TICKETS_ISSUED,
      data: { outboxEventId: event!._id },
      attemptsMade: 0,
      opts: { attempts: 5 },
      moveToDelayed,
    } as unknown as Job;
    await expect(
      h.worker.get(TicketsEmailProcessor).process(job, 'lock-token'),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(until.getTime() + 1000, 'lock-token');
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe('без APP_WEB_ORIGIN', () => {
  it('письмо без кнопки, с текстом «в приложении»', async () => {
    const plain = await createHarness();
    try {
      const { admin, raceId } = await raceWorld(plain);
      await enableRaceTickets(plain, admin.token, raceId);
      const who = await rider(plain, 'a@example.com');
      await enter(plain, who.auth, raceId);
      await raceTicket(plain, who.auth, raceId);
      expect(await sendTicketEmails(plain)).toEqual(['sent']);
      const mail = plain.mailer.sent[0]!;
      expect(mail.html).not.toContain('<a ');
      expect(mail.text).toContain('Билет — в приложении «Покатим».');
    } finally {
      await plain.reset();
      await plain.close();
    }
  });
});
