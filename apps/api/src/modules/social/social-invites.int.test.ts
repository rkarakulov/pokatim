import { InviteCodeResponse } from '@pokatim/contracts';
import { CLOCK } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  bearer,
  call,
  collections,
  confirm,
  outboxEvents,
  register,
  userIdByEmail,
} from '../../../test/identity';
import { appendEvent } from '../../../test/notifications';
import { rider } from '../../../test/rides';
import { publicRider } from '../../../test/profiles';
import { socialDb, socialServices } from '../../../test/social';
import { InviteCodesRepository } from './invite-codes.repository';
import { InviteCodes } from './invite-codes.service';
import { SocialIntakeProcessor } from './social-intake.processor';

/**
 * Приглашения «Свои» (K9, P6): личный код (`GET /v1/social/invite-code`, выдача лениво, коллизии) и intake
 * `identity.account-confirmed` → связь `invite` в обе стороны и `invite-registered` (AC1, AC6, AC7).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const CONFIRMED = 'identity.account-confirmed';
const getCode = (token?: string) =>
  call(h, 'GET', '/v1/social/invite-code', undefined, token ? bearer(token) : {});

async function codeOf(token: string): Promise<string> {
  const res = await getCode(token);
  expect(res.status).toBe(200);
  return InviteCodeResponse.parse(res.body).code;
}

/** Приглашённый: регистрация с кодом и подтверждение e-mail по ссылке; id. */
async function invitee(email: string, invite: unknown): Promise<string> {
  expect((await register(h, { email, invite })).status).toBe(201);
  expect((await confirm(h, await activeLinkToken(h, email))).status).toBe(200);
  return userIdByEmail(h, email);
}

const job = (name: string, outboxEventId: string) =>
  ({ name, data: { outboxEventId }, attemptsMade: 0, opts: { attempts: 5 } }) as unknown as Job;

/** Задачи `social-intake` по всем событиям `identity.account-confirmed` (как публикатор + worker). */
async function runIntake(): Promise<string[]> {
  const processor = h.worker.get(SocialIntakeProcessor);
  const outcomes: string[] = [];
  for (const event of await outboxEvents(h)) {
    if (event.type === CONFIRMED)
      outcomes.push(await processor.process(job(event.type, event._id)));
  }
  return outcomes;
}

const inviteConnections = () =>
  socialDb(h)
    .connections.find(
      { inviteAt: { $ne: null } },
      { projection: { _id: 0, ownerId: 1, otherId: 1 } },
    )
    .toArray();
const eventsOf = (type: 'connection-created' | 'invite-registered') =>
  socialDb(h).events.find({ type }).toArray();

describe('GET /v1/social/invite-code (AC1)', () => {
  it('без входа — 401', async () => {
    expect((await getCode()).status).toBe(401);
  });

  it('вошедшему — один и тот же код по формату, no-store; у разных райдеров — разные', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    const res = await getCode(a.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const code = InviteCodeResponse.parse(res.body).code;
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{7}$/);
    expect(await codeOf(a.token)).toBe(code);
    expect(await codeOf(b.token)).not.toBe(code);
    expect(await socialDb(h).inviteCodes.countDocuments()).toBe(2);
  });

  it('параллельная первая выдача — один код', async () => {
    const a = await rider(h, 'a@example.by');
    const codes = h.worker.get(InviteCodes);
    const issued = await Promise.all(Array.from({ length: 8 }, () => codes.ensureOf(a.userId)));
    expect(new Set(issued).size).toBe(1);
    expect(await socialDb(h).inviteCodes.countDocuments({ _id: a.userId })).toBe(1);
  });

  it('коллизия кода — новый код (внедрённый генератор)', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    const sequence = ['K7M2PQX', 'K7M2PQX', 'Z9Z9Z9Z'];
    const codes = new InviteCodes(
      h.worker.get(InviteCodesRepository),
      h.worker.get(CLOCK),
      () => sequence.shift() ?? 'NEVER22',
    );
    expect(await codes.ensureOf(a.userId)).toBe('K7M2PQX');
    expect(await codes.ensureOf(b.userId)).toBe('Z9Z9Z9Z');
    expect(await codes.ownerOf('Z9Z9Z9Z')).toBe(b.userId);
  });
});

describe('intake identity.account-confirmed (AC6, AC7)', () => {
  it('валидный код → две связи invite, два connection-created, одно invite-registered; повтор — без изменений', async () => {
    const a = await rider(h, 'a@example.by');
    const code = await codeOf(a.token);
    const b = await invitee('b@example.by', code.toLowerCase());

    expect(await runIntake()).toEqual(['linked']);
    expect(await inviteConnections()).toEqual(
      expect.arrayContaining([
        { ownerId: a.userId, otherId: b },
        { ownerId: b, otherId: a.userId },
      ]),
    );
    expect(await inviteConnections()).toHaveLength(2);
    expect(await eventsOf('connection-created')).toHaveLength(2);
    const registered = await eventsOf('invite-registered');
    expect(registered).toMatchObject([{ userId: a.userId, props: {} }]);

    const before = {
      connections: await socialDb(h).connections.find().toArray(),
      events: await socialDb(h).events.find().toArray(),
    };
    expect(await runIntake()).toEqual(['already_linked']);
    expect({
      connections: await socialDb(h).connections.find().toArray(),
      events: await socialDb(h).events.find().toArray(),
    }).toEqual(before);
  });

  it('неизвестный код — связей нет, регистрация успешна', async () => {
    await rider(h, 'a@example.by');
    await invitee('b@example.by', 'K7M2PQX');
    expect(await runIntake()).toEqual(['unknown_code']);
    expect(await inviteConnections()).toEqual([]);
  });

  it('свой код — связей нет', async () => {
    const a = await rider(h, 'a@example.by');
    const code = await codeOf(a.token);
    // код своего аккаунта на users — прямой записью (свой код до регистрации получить нельзя)
    await collections(h).users.updateOne({ _id: a.userId }, { $set: { invite: code } });
    await appendEvent(h, CONFIRMED, { userId: a.userId, invite: code });
    expect(await runIntake()).toEqual(['self']);
    expect(await inviteConnections()).toEqual([]);
  });

  it('пригласивший помечен удалённым (код ещё не стёрт) — связей нет', async () => {
    const a = await rider(h, 'a@example.by');
    const code = await codeOf(a.token);
    await invitee('b@example.by', code);
    await collections(h).users.updateOne({ _id: a.userId }, { $set: { deletedAt: h.clock.now() } });
    expect(await runIntake()).toEqual(['inviter_deleted']);
    expect(await inviteConnections()).toEqual([]);
    expect(await eventsOf('invite-registered')).toEqual([]);
  });

  it('приглашённый удалён к моменту обработки — связей нет', async () => {
    const a = await rider(h, 'a@example.by');
    const b = await invitee('b@example.by', await codeOf(a.token));
    await collections(h).users.updateOne({ _id: b }, { $set: { deletedAt: h.clock.now() } });
    expect(await runIntake()).toEqual(['invitee_deleted']);
    expect(await inviteConnections()).toEqual([]);
  });

  it('неверный формат кода — регистрация успешна, события нет; payload не по схеме — skipped', async () => {
    await rider(h, 'a@example.by');
    await invitee('b@example.by', 'K7M2PQ0');
    expect((await collections(h).users.findOne({ email: 'b@example.by' }))?.invite).toBeNull();
    expect(await runIntake()).toEqual([]);

    await appendEvent(h, CONFIRMED, { userId: 'nope', invite: 'K7M2PQX' });
    expect(await runIntake()).toEqual(['skipped']);
    expect(await inviteConnections()).toEqual([]);
  });

  it('пара уже связана вручную: invite-registered — при первом inviteAt (RC-P6-8), повтор — без дубля', async () => {
    const a = await publicRider(h, 'a@example.by');
    const b = await publicRider(h, 'b@example.by');
    const connections = socialServices(h).connections;
    await connections.addManual(a.userId, b.userId);
    expect(await connections.linkInvite(a.userId, b.userId)).toBe(true);
    expect(await connections.linkInvite(a.userId, b.userId)).toBe(false);
    expect(await eventsOf('invite-registered')).toMatchObject([{ userId: a.userId }]);
    // a → b существовала (manual), b → a создана: connection-created manual + invite
    expect((await eventsOf('connection-created')).map((event) => event.props)).toEqual([
      { source: 'manual' },
      { source: 'invite' },
    ]);
  });
});
