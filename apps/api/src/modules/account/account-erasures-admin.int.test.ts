import { AccountErasurePage, AuditPage, RetryAccountErasureResult } from '@pokatim/contracts';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { jobOf } from '../../../test/devices';
import { createHarness, DAY, HOUR, type Harness, MINUTE } from '../../../test/harness';
import {
  bearer,
  call,
  collections,
  outboxEvents,
  signUpSession,
  validRegistration,
} from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import { RouteErasure } from '../routes';
import { AccountErasureProcessor } from './account-erasure.processor';
import { ACCOUNT_DELETION_REQUESTED, ACCOUNT_ERASURE_RETRY_REQUESTED } from './account.events';

/**
 * Сбои удаления аккаунтов в панели (erasure-failures): список зависших (порог «Обзора» — сутки), права, повтор с
 * журналом и outbox, идемпотентность, запись провала шага worker. Без ПДн в ответах.
 */
const ERASURES = '/v1/admin/account-erasures';
const EMAIL = 'gone@example.com';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
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

const users = () => collections(h).users;
const processor = () => h.worker.get(AccountErasureProcessor);
const ago = (ms: number) => new Date(h.clock.now().getTime() - ms);

/** Удалённый аккаунт напрямую в БД (фильтры порта, не сценарий удаления). */
async function seedDeleted(id: string, deletedAt: Date, extra: Record<string, unknown> = {}) {
  await users().insertOne({
    _id: id,
    email: `erased:${id}`,
    passwordHash: null,
    birthDate: null,
    emailVerifiedAt: deletedAt,
    createdAt: deletedAt,
    deletedAt,
    version: 1,
    ...extra,
  });
}

const uid = (n: number) => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`;

/** Райдер удаляет аккаунт по HTTP (как приложение); id пользователя. */
async function deletedRider(): Promise<string> {
  const session = await signUpSession(h, EMAIL);
  const res = await call(
    h,
    'POST',
    '/v1/account/delete',
    { password: validRegistration().password },
    bearer(session.accessToken),
  );
  expect(res.status).toBe(204);
  const user = await users().findOne({ email: EMAIL });
  if (!user) throw new Error('no user');
  return user._id;
}

async function runOutbox(type: string, attemptsMade = 0) {
  for (const event of await outboxEvents(h)) {
    if (event.type !== type) continue;
    await processor().process(jobOf(type, { outboxEventId: event._id }, attemptsMade) as Job);
  }
}

const retry = (token: string, userId: string, reason = 'Починили SMTP') =>
  panelCall(h, token, 'POST', `${ERASURES}/${userId}/retry`, { reason });

describe('список зависших удалений', () => {
  it('только удалённые больше суток назад без завершённой очистки; давние первыми; курсор без дублей', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await seedDeleted(uid(1), ago(3 * DAY), {
      erasureFailedAttempts: 5,
      erasureLastFailure: { step: 'routes', code: 'MongoServerError', at: ago(2 * DAY) },
    });
    await seedDeleted(uid(2), ago(2 * DAY));
    await seedDeleted(uid(3), ago(2 * DAY));
    await seedDeleted(uid(4), ago(DAY - HOUR)); // ещё не зависло
    await seedDeleted(uid(5), ago(5 * DAY), { erasureSweptAt: ago(4 * DAY) }); // завершено

    const first = await panelCall(h, admin.token, 'GET', `${ERASURES}?limit=2`);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const page1 = AccountErasurePage.parse(first.body);
    expect(page1.items).toEqual([
      {
        userId: uid(1),
        deletedAt: ago(3 * DAY).toISOString(),
        failedAttempts: 5,
        lastFailure: { step: 'routes', code: 'MongoServerError', at: ago(2 * DAY).toISOString() },
        retryRequestedAt: null,
      },
      {
        userId: uid(2),
        deletedAt: ago(2 * DAY).toISOString(),
        failedAttempts: 0,
        lastFailure: null,
        retryRequestedAt: null,
      },
    ]);
    expect(page1.nextCursor).not.toBeNull();

    const second = await panelCall(
      h,
      admin.token,
      'GET',
      `${ERASURES}?limit=2&cursor=${page1.nextCursor}`,
    );
    const page2 = AccountErasurePage.parse(second.body);
    expect(page2.items.map((row) => row.userId)).toEqual([uid(3)]);
    expect(page2.nextCursor).toBeNull();
  });

  it('число строк = карточка «Обзора»', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await seedDeleted(uid(1), ago(2 * DAY));
    await seedDeleted(uid(2), ago(HOUR));
    const overview = await panelCall(h, admin.token, 'GET', '/v1/admin/overview');
    const list = AccountErasurePage.parse((await panelCall(h, admin.token, 'GET', ERASURES)).body);
    expect(
      (overview.body as { attention: { accountDeletions: { stuck: number } } }).attention,
    ).toMatchObject({ accountDeletions: { stuck: list.items.length } });
    expect(list.items).toHaveLength(1);
  });

  it('без platform.stats — 403 (moderator, organizer); без сессии — 401; мусорный курсор — 400', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    const organizer = await staff(h, 'organizer@example.by', 'organizer');
    await seedDeleted(uid(1), ago(2 * DAY));
    for (const token of [moderator.token, organizer.token]) {
      expect((await panelCall(h, token, 'GET', ERASURES)).status).toBe(403);
      expect((await retry(token, uid(1))).status).toBe(403);
    }
    expect((await panelCall(h, undefined, 'GET', ERASURES)).status).toBe(401);
    expect((await panelCall(h, admin.token, 'GET', `${ERASURES}?cursor=%%%`)).status).toBe(400);
  });
});

describe('провал шага в worker', () => {
  it('пишет шаг, безопасный код и счётчик попыток; текст ошибки (e-mail) не хранится', async () => {
    const userId = await deletedRider();
    const failure = Object.assign(new Error(`duplicate key { email: "${EMAIL}" }`), {
      code: 11000,
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(h.worker.get(RouteErasure), 'erase')
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(new Error(`smtp to ${EMAIL}`));

    await expect(runOutbox(ACCOUNT_DELETION_REQUESTED)).rejects.toThrow();
    await expect(runOutbox(ACCOUNT_DELETION_REQUESTED, 4)).rejects.toThrow();

    const doc = await users().findOne({ _id: userId });
    expect(doc?.erasureFailedAttempts).toBe(2);
    expect(doc?.erasureLastFailure).toEqual({ step: 'routes', code: 'Error', at: h.clock.now() });
    expect(JSON.stringify(doc?.erasureLastFailure)).not.toContain('@');
  });

  it('сбой SMTP на шаге identity — код почты (ECONNECTION), без адреса', async () => {
    const userId = await deletedRider();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(h.mailer, 'send').mockRejectedValueOnce(
      Object.assign(new Error(`connect failed for ${EMAIL}`), { code: 'ECONNECTION' }),
    );

    await expect(runOutbox(ACCOUNT_DELETION_REQUESTED)).rejects.toThrow();

    const doc = await users().findOne({ _id: userId });
    expect(doc?.erasureLastFailure).toEqual({
      step: 'identity',
      code: 'ECONNECTION',
      at: h.clock.now(),
    });
  });
});

describe('«Повторить удаление»', () => {
  it('журнал с причиной и подписью без ПДн, outbox; worker завершает очистку; строка уходит из списка', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const userId = await deletedRider();
    vi.spyOn(h.worker.get(RouteErasure), 'erase').mockRejectedValueOnce(new Error('boom'));
    await expect(runOutbox(ACCOUNT_DELETION_REQUESTED)).rejects.toThrow('boom');
    // очистка «зависла»: удалён больше суток назад
    await users().updateOne({ _id: userId }, { $set: { deletedAt: ago(2 * DAY) } });

    const res = await retry(admin.token, userId);
    expect(res.status).toBe(200);
    expect(RetryAccountErasureResult.parse(res.body)).toEqual({ queued: true });
    expect(JSON.stringify(res.body)).not.toContain('@');

    const audit = AuditPage.parse(
      (await panelCall(h, admin.token, 'GET', '/v1/admin/audit?action=account.erasure_retried'))
        .body,
    );
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({
      reason: 'Починили SMTP',
      subject: { kind: 'rider', id: userId, label: `Участник ·${userId.slice(-6)}` },
    });
    expect(JSON.stringify(audit.items[0])).not.toContain(EMAIL);

    const listed = AccountErasurePage.parse(
      (await panelCall(h, admin.token, 'GET', ERASURES)).body,
    );
    expect(listed.items[0]).toMatchObject({
      userId,
      failedAttempts: 1,
      retryRequestedAt: h.clock.now().toISOString(),
      lastFailure: { step: 'routes', code: 'Error' },
    });

    await runOutbox(ACCOUNT_ERASURE_RETRY_REQUESTED);
    expect((await users().findOne({ _id: userId }))?.erasureSweptAt).toEqual(h.clock.now());
    expect(
      AccountErasurePage.parse((await panelCall(h, admin.token, 'GET', ERASURES)).body).items,
    ).toEqual([]);
    // завершено — повтор больше не ставится
    expect((await retry(admin.token, userId)).status).toBe(409);
  });

  it('идемпотентно: повтор в окне 15 мин — queued: false без второй записи; после нового сбоя или окна — снова', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await seedDeleted(uid(1), ago(2 * DAY));
    const retries = () =>
      outboxEvents(h).then((events) =>
        events.filter((event) => event.type === ACCOUNT_ERASURE_RETRY_REQUESTED),
      );

    expect((await retry(admin.token, uid(1))).body).toEqual({ queued: true });
    expect((await retry(admin.token, uid(1))).body).toEqual({ queued: false });
    expect(await retries()).toHaveLength(1);
    const audits = () =>
      h.db.collection('panel_audit').countDocuments({ action: 'account.erasure_retried' });
    expect(await audits()).toBe(1);

    // повтор упал после запроса — можно снова, не дожидаясь окна
    h.clock.advance(MINUTE);
    await users().updateOne(
      { _id: uid(1) },
      {
        $set: { erasureLastFailure: { step: 'identity', code: 'ECONNECTION', at: h.clock.now() } },
      },
    );
    expect((await retry(admin.token, uid(1))).body).toEqual({ queued: true });
    expect(await audits()).toBe(2);

    // без нового сбоя: ровно 15 мин — ещё «уже запрошен», позже — снова
    h.clock.advance(15 * MINUTE);
    expect((await retry(admin.token, uid(1))).body).toEqual({ queued: false });
    h.clock.advance(1);
    expect((await retry(admin.token, uid(1))).body).toEqual({ queued: true });
    expect(await audits()).toBe(3);
  });

  it('нет аккаунта или живой — 404; ещё не зависло — 409; без причины — 400', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await seedDeleted(uid(2), ago(HOUR));
    expect((await retry(admin.token, uid(1))).status).toBe(404);
    expect((await retry(admin.token, admin.userId)).status).toBe(404);
    expect((await retry(admin.token, uid(2))).status).toBe(409);
    expect(
      (await panelCall(h, admin.token, 'POST', `${ERASURES}/${uid(2)}/retry`, {})).status,
    ).toBe(400);
    expect((await retry(admin.token, 'not-a-uuid')).status).toBe(400);
  });
});
