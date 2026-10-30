import { Logger } from '@nestjs/common';
import { RiderProfileViewer } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, holdTransaction, retried, untilBlocked } from '../../../test/identity';
import {
  patchProfile,
  profileModerationCall,
  profileReportsDb,
  profilesDb,
  type PublicRider,
  publicRider,
  reportRider,
  riderViewer,
} from '../../../test/profiles';
import { staff } from '../../../test/races';
import { rider, type Rider } from '../../../test/rides';
import { PROFILE_POLICY } from './profile.policy';
import { ProfileRepository } from './profile.repository';

/**
 * Жалобы на публичный профиль (profile-moderation, AC1–AC2): одна открытая от пользователя, свой — 409, непубличный
 * и неизвестный — 404, лимит 20/сут; `me` — состояние зрителя. Транзакция жалобы: запись профиля первой (гонка со
 * сбросом), `openReportCount` = числу открытых жалоб.
 */
let h: Harness;
let target: PublicRider;
let a: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  target = await publicRider(h, 'target@example.by');
  a = await rider(h, 'a@example.by');
});
afterAll(async () => {
  await h.close();
});

const profileOf = (userId: string) => profilesDb(h).findOne({ _id: userId });
const openCount = (userId: string) =>
  profileReportsDb(h).countDocuments({ targetUserId: userId, resolvedAt: null });

describe('POST /v1/riders/:publicId/reports (AC1)', () => {
  it('200: reported; запись жалобы; счётчик, ревизия и время в профиле; updatedAt профиля не меняется', async () => {
    const before = await profileOf(target.userId);
    h.clock.advance(60_000);
    const res = await reportRider(h, a.token, target.publicId, {
      reason: 'club',
      comment: ' Мат в клубе ',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(RiderProfileViewer.parse(res.body)).toEqual({ canReport: false, reported: true });
    expect(await profileReportsDb(h).find().toArray()).toEqual([
      {
        _id: expect.any(String),
        targetUserId: target.userId,
        reporterUserId: a.userId,
        reason: 'club',
        comment: 'Мат в клубе',
        createdAt: h.clock.now(),
        resolvedAt: null,
        resolution: null,
        resolvedBy: null,
      },
    ]);
    expect(await profileOf(target.userId)).toMatchObject({
      openReportCount: 1,
      reportRevision: 1,
      lastReportAt: h.clock.now(),
      updatedAt: before?.updatedAt,
    });
  });

  it('повтор при открытой — 200 без второй записи; счётчик 1', async () => {
    expect((await reportRider(h, a.token, target.publicId)).status).toBe(200);
    const again = await reportRider(h, a.token, target.publicId, { reason: 'spam' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ canReport: false, reported: true });
    expect(await profileReportsDb(h).countDocuments()).toBe(1);
    expect(await profileOf(target.userId)).toMatchObject({ openReportCount: 1, reportRevision: 1 });
  });

  it('параллельные две жалобы одного пользователя — одна запись', async () => {
    const results = await Promise.all([
      reportRider(h, a.token, target.publicId),
      reportRider(h, a.token, target.publicId),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await profileReportsDb(h).countDocuments()).toBe(1);
    expect((await profileOf(target.userId))?.openReportCount).toBe(1);
  });

  it('свой профиль — 409 PROFILE_INVALID_STATE own_profile, записи нет', async () => {
    const res = await reportRider(h, target.token, target.publicId);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'PROFILE_INVALID_STATE',
      details: { reason: 'own_profile' },
    });
    expect(await profileReportsDb(h).countDocuments()).toBe(0);
  });

  it('непубличный (нет согласия, нет имени) и неизвестный — 404', async () => {
    const revoked = await publicRider(h, 'revoked@example.by', 'Борис');
    await patchProfile(h, revoked, { showNameInResults: false });
    const nameless = await publicRider(h, 'nameless@example.by', 'Вера');
    await patchProfile(h, nameless, { publicName: null });
    for (const publicId of [revoked.publicId, nameless.publicId, 'z'.repeat(43)]) {
      const res = await reportRider(h, a.token, publicId);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await profileReportsDb(h).countDocuments()).toBe(0);
  });

  it.each([
    ['кривой publicId', 'bad id', { reason: 'photo' }],
    ['неверная причина', null, { reason: 'boring' }],
    ['комментарий 501', null, { reason: 'other', comment: 'a'.repeat(501) }],
    ['лишний ключ', null, { reason: 'photo', targetUserId: 'x' }],
  ])('%s — 400 VALIDATION_FAILED', async (_name, publicId, body) => {
    const res = await reportRider(h, a.token, publicId ?? target.publicId, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await profileReportsDb(h).countDocuments()).toBe(0);
  });

  it('без входа — 401', async () => {
    expect((await reportRider(h, undefined, target.publicId)).status).toBe(401);
  });

  it('лимит profile-report: 21-я за сутки — 429 + retryAfterSec (повторы тоже считаются)', async () => {
    for (let i = 0; i < PROFILE_POLICY.reportLimit.limit; i += 1) {
      expect((await reportRider(h, a.token, target.publicId)).status).toBe(200);
    }
    const limited = await reportRider(h, a.token, target.publicId);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('лог: жалобщик и причина — без publicId, цели и комментария', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await reportRider(h, a.token, target.publicId, {
        reason: 'other',
        comment: 'Секретный комментарий',
      });
      const lines = log.mock.calls.map((args) => String(args[0]));
      expect(lines).toContain(`profile.reported uid=${a.userId} reason=other`);
      const all = lines.join('\n');
      expect(all).not.toMatch(/Секретн/);
      expect(all).not.toContain(target.publicId);
      expect(all).not.toContain(target.userId);
    } finally {
      log.mockRestore();
    }
  });
});

describe('openReasons профиля (profile-moderation-followups, RC-F1)', () => {
  it('жалоба добавляет причину без дублей; сброс и «Отклонить жалобы» очищают', async () => {
    const b = await rider(h, 'b@example.by');
    const c = await rider(h, 'c@example.by');
    await reportRider(h, a.token, target.publicId, { reason: 'name' });
    await reportRider(h, b.token, target.publicId, { reason: 'name' });
    await reportRider(h, c.token, target.publicId, { reason: 'photo' });
    expect([...((await profileOf(target.userId))?.openReasons ?? [])].sort()).toEqual([
      'name',
      'photo',
    ]);

    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    await profileModerationCall(h, moderator.token, 'POST', `/${target.userId}/club-reset`, {
      reason: 'Мат в клубе',
    });
    expect((await profileOf(target.userId))?.openReasons).toEqual([]);

    await reportRider(h, a.token, target.publicId, { reason: 'spam' });
    expect((await profileOf(target.userId))?.openReasons).toEqual(['spam']);
    await profileModerationCall(h, moderator.token, 'POST', `/${target.userId}/dismiss-reports`, {
      reason: 'Всё в порядке',
      reportRevision: 4,
    });
    expect((await profileOf(target.userId))?.openReasons).toEqual([]);
  });
});

describe('GET /v1/riders/:publicId/me (AC2)', () => {
  it('до и после жалобы; после «Отклонить жалобы» — снова canReport, вторая жалоба принимается (S-1)', async () => {
    expect((await riderViewer(h, a.token, target.publicId)).body).toEqual({
      canReport: true,
      reported: false,
    });
    await reportRider(h, a.token, target.publicId);
    const after = await riderViewer(h, a.token, target.publicId);
    expect(after.headers['cache-control']).toBe('no-store');
    expect(after.body).toEqual({ canReport: false, reported: true });

    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    const dismissed = await profileModerationCall(
      h,
      moderator.token,
      'POST',
      `/${target.userId}/dismiss-reports`,
      { reason: 'Всё в порядке', reportRevision: 1 },
    );
    expect(dismissed.body).toEqual({ dismissed: true });
    expect((await riderViewer(h, a.token, target.publicId)).body).toEqual({
      canReport: true,
      reported: false,
    });
    expect((await reportRider(h, a.token, target.publicId)).status).toBe(200);
    expect(await profileReportsDb(h).countDocuments({ targetUserId: target.userId })).toBe(2);
    expect(await openCount(target.userId)).toBe(1);
    expect(await profileOf(target.userId)).toMatchObject({ openReportCount: 1, reportRevision: 2 });
  });

  it('свой — canReport: false, reported: false', async () => {
    expect((await riderViewer(h, target.token, target.publicId)).body).toEqual({
      canReport: false,
      reported: false,
    });
  });

  it('непубличный — 404; без токена — 401, а публичный профиль без токена — 200', async () => {
    const revoked = await publicRider(h, 'revoked@example.by', 'Борис');
    await patchProfile(h, revoked, { showNameInResults: false });
    expect((await riderViewer(h, a.token, revoked.publicId)).status).toBe(404);
    expect((await riderViewer(h, undefined, target.publicId)).status).toBe(401);
    expect((await call(h, 'GET', `/v1/riders/${target.publicId}`)).status).toBe(200);
  });
});

describe('гонка «жалоба ↔ сброс» (запись профиля первой)', () => {
  it('удерживаемый сброс: жалоба повторяется; после коммита openReportCount = числу открытых жалоб', async () => {
    const b = await rider(h, 'b@example.by');
    await reportRider(h, b.token, target.publicId);
    const repository = h.app.get(ProfileRepository, { strict: false });
    const spy = vi.spyOn(repository, 'recordReport');
    const now = h.clock.now();
    const held = await holdTransaction(h, async (session) => {
      await profilesDb(h).updateOne(
        { _id: target.userId },
        { $set: { club: null, openReportCount: 0, updatedAt: now } },
        { session },
      );
      await profileReportsDb(h).updateMany(
        { targetUserId: target.userId, resolvedAt: null },
        { $set: { resolvedAt: now, resolution: 'actioned', resolvedBy: b.userId } },
        { session },
      );
    });
    const pending = reportRider(h, a.token, target.publicId);
    await untilBlocked(pending, retried(spy));
    await held.commit();
    const res = await pending;
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(await openCount(target.userId)).toBe(1);
    expect((await profileOf(target.userId))?.openReportCount).toBe(1);
  });

  it('параллельно: жалобы и «Сбросить клуб» — openReportCount = числу открытых жалоб', async () => {
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    for (let round = 0; round < 3; round += 1) {
      const who = await publicRider(h, `t${round}@example.by`, `Цель ${round}`);
      const reporters = await Promise.all(
        [1, 2, 3].map((i) => rider(h, `r${round}-${i}@example.by`)),
      );
      await Promise.all([
        ...reporters.map((reporter) => reportRider(h, reporter.token, who.publicId)),
        profileModerationCall(h, moderator.token, 'POST', `/${who.userId}/club-reset`, {
          reason: 'Мат в клубе',
        }),
      ]);
      expect((await profileOf(who.userId))?.openReportCount ?? 0).toBe(await openCount(who.userId));
    }
  });
});
