import { Logger } from '@nestjs/common';
import {
  type AuditAction,
  ProfileView,
  RiderProfileModerationDetail,
  RiderProfileModerationPage,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { eventsOfType } from '../../../test/notifications';
import { bearer, call } from '../../../test/identity';
import { panel, panelCall, panelSession } from '../../../test/panel';
import {
  fetchAvatar,
  patchProfile,
  profileModerationCall,
  profileReportsDb,
  profilesDb,
  type PublicRider,
  publicRider,
  reportRider,
  seedAvatar,
} from '../../../test/profiles';
import { staff } from '../../../test/races';
import { twoToneImage } from '../../../test/avatars';
import { heldUpload } from '../../../test/uploads';
import { UploadSlots } from '../../upload-slots';
import { rider } from '../../../test/rides';
import { PROFILE_FIELD_RESET } from './profile.events';

/**
 * Модерация профилей в панели (profile-moderation, AC3–AC7): очередь (только с открытыми жалобами, порядок, курсор,
 * подпись Q2), карточка (фото и клуб скрытого, жалобы без автора, ревизия), сбросы фото/клуба (жалобы `actioned`,
 * журнал без ПДн, повтор — `{ reset: false }`) и «Отклонить жалобы» (ревизия — 409 `CONFLICT`).
 */
let h: Harness;
let moderator: { userId: string; token: string };
let target: PublicRider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  moderator = await staff(h, 'moderator@example.by', 'moderator');
  target = await publicRider(h, 'target@example.by', 'Анна К.', 'Секретный клуб');
});
afterAll(async () => {
  await h.close();
});

const REASON = 'Неприличное содержимое';
const mod = (method: 'GET' | 'POST', path: string, body?: unknown) =>
  profileModerationCall(h, moderator.token, method, path, body);
const auditOf = (action: AuditAction) => panel(h).audit.find({ action }).toArray();
const profileOf = (userId: string) => profilesDb(h).findOne({ _id: userId });

/** Жалобы от новых райдеров на профиль (по одной на райдера). */
let reporterSeq = 0;
async function reportsOn(who: PublicRider, reasons: readonly string[]): Promise<void> {
  for (const [i, reason] of reasons.entries()) {
    reporterSeq += 1;
    const reporter = await rider(h, `reporter-${reporterSeq}@example.by`);
    const res = await reportRider(h, reporter.token, who.publicId, {
      reason,
      comment: `Комментарий ${i}`,
    });
    if (res.status !== 200) throw new Error(`жалоба: ${res.status}`);
  }
}

describe('GET /v1/admin/rider-profiles — очередь (AC3)', () => {
  it('только профили с открытыми жалобами, новые жалобы сверху; курсор; подпись — по Q2', async () => {
    const hidden = await publicRider(h, 'hidden@example.by', 'Борис');
    await publicRider(h, 'quiet@example.by', 'Тихий');
    await reportsOn(target, ['photo']);
    h.clock.advance(60_000);
    await reportsOn(hidden, ['club', 'name', 'name']);
    await patchProfile(
      h,
      { token: hidden.token, userId: hidden.userId },
      { showNameInResults: false },
    );

    const first = await mod('GET', '?limit=1');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const page1 = RiderProfileModerationPage.parse(first.body);
    expect(page1.items).toEqual([
      {
        userId: hidden.userId,
        name: null,
        openReportCount: 3,
        topReason: 'name',
        lastReportAt: h.clock.now().toISOString(),
        hasAvatar: false,
        hasClub: true,
        openReasons: ['club', 'name'],
      },
    ]);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = RiderProfileModerationPage.parse(
      (await mod('GET', `?limit=1&cursor=${page1.nextCursor}`)).body,
    );
    expect(page2.items.map((row) => [row.userId, row.name, row.topReason])).toEqual([
      [target.userId, 'Анна К.', 'photo'],
    ]);
    expect(page2.nextCursor).toBeNull();
  });

  it('ничья причин — порядок справочника; профиль без открытых жалоб в очереди нет', async () => {
    await reportsOn(target, ['spam', 'club']);
    const page = RiderProfileModerationPage.parse((await mod('GET', '')).body);
    expect(page.items.map((row) => row.topReason)).toEqual(['club']);
    const detail = RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body);
    await mod('POST', `/${target.userId}/dismiss-reports`, {
      reason: REASON,
      reportRevision: detail.reportRevision,
    });
    expect(RiderProfileModerationPage.parse((await mod('GET', '')).body).items).toEqual([]);
  });

  it('мусорный курсор и лимит вне 1–50 — 400; organizer — 403; без сессии — 401', async () => {
    expect((await mod('GET', '?cursor=%%%')).status).toBe(400);
    expect((await mod('GET', '?cursor=abc')).status).toBe(400);
    expect((await mod('GET', '?limit=51')).status).toBe(400);
    const organizer = await staff(h, 'org@example.by', 'organizer');
    expect((await profileModerationCall(h, organizer.token, 'GET', '')).status).toBe(403);
    expect((await profileModerationCall(h, undefined, 'GET', '')).status).toBe(401);
    expect(
      (await call(h, 'GET', '/v1/admin/rider-profiles', undefined, bearer(target.token))).status,
    ).toBe(401);
  });
});

describe('GET /v1/admin/rider-profiles/:userId — карточка (AC4)', () => {
  it('фото и клуб скрытого профиля видны, имя — null; жалобы без автора; ревизия', async () => {
    const avatar = await seedAvatar(h, target.userId);
    await reportsOn(target, ['photo', 'club']);
    await patchProfile(h, target, { showNameInResults: false });
    const reissued = (await profileOf(target.userId))?.avatarId;

    const res = await mod('GET', `/${target.userId}`);
    expect(res.status).toBe(200);
    const detail = RiderProfileModerationDetail.parse(res.body);
    expect(detail).toMatchObject({
      userId: target.userId,
      name: null,
      club: 'Секретный клуб',
      avatar: { id: reissued },
      isPublic: false,
      openReportCount: 2,
      reportRevision: 2,
      lastReportAt: h.clock.now().toISOString(),
    });
    expect(reissued).not.toBe(avatar.id);
    expect(detail.reports.map((report) => [report.reason, report.comment])).toEqual([
      ['club', 'Комментарий 1'],
      ['photo', 'Комментарий 0'],
    ]);
    for (const report of (res.body as { reports: Record<string, unknown>[] }).reports) {
      expect(Object.keys(report).sort()).toEqual(
        ['comment', 'createdAt', 'id', 'reason', 'resolution', 'resolvedAt'].sort(),
      );
    }
  });

  it('публичный — имя и isPublic; профиля нет — 404; не Uuid — 400', async () => {
    const detail = RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body);
    expect(detail).toMatchObject({
      name: 'Анна К.',
      isPublic: true,
      avatar: null,
      openReportCount: 0,
      reportRevision: 0,
      lastReportAt: null,
      reports: [],
    });
    const none = await mod('GET', `/${uuidv7()}`);
    expect(none.status).toBe(404);
    expect(none.body).toMatchObject({ code: 'NOT_FOUND' });
    expect((await mod('GET', '/not-a-uuid')).status).toBe(400);
  });
});

describe('POST avatar-reset и club-reset (AC5–AC6)', () => {
  it('avatar-reset: старый URL — 404, avatar: null, жалобы actioned, журнал без клуба, имени и id фото', async () => {
    const avatar = await seedAvatar(h, target.userId);
    await reportsOn(target, ['photo', 'other']);
    expect((await fetchAvatar(h, avatar.id)).status).toBe(200);

    const res = await mod('POST', `/${target.userId}/avatar-reset`, { reason: REASON });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true });

    expect((await fetchAvatar(h, avatar.id)).status).toBe(404);
    const own = await call(h, 'GET', '/v1/profile', undefined, bearer(target.token));
    expect(ProfileView.parse(own.body)).toMatchObject({ avatar: null, club: 'Секретный клуб' });
    expect(
      await profileReportsDb(h)
        .find({ targetUserId: target.userId })
        .project({ _id: 0, resolution: 1, resolvedBy: 1, resolvedAt: 1 })
        .toArray(),
    ).toEqual([
      { resolution: 'actioned', resolvedBy: moderator.userId, resolvedAt: h.clock.now() },
      { resolution: 'actioned', resolvedBy: moderator.userId, resolvedAt: h.clock.now() },
    ]);
    expect((await profileOf(target.userId))?.openReportCount).toBe(0);
    const audit = await auditOf('profile.avatar_reset');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: moderator.userId },
      subject: { kind: 'rider', id: target.userId, label: `Участник ·${target.userId.slice(-6)}` },
      targetUserId: null,
      reason: REASON,
      details: { reportCount: 2 },
    });
    const json = JSON.stringify(audit);
    expect(json).not.toContain('Секретный клуб');
    expect(json).not.toContain('Анна К.');
    expect(json).not.toContain(avatar.id);
  });

  it('avatar-reset повтор (фото нет) — { reset: false } без журнала, жалобы открыты', async () => {
    await reportsOn(target, ['photo']);
    const res = await mod('POST', `/${target.userId}/avatar-reset`, { reason: REASON });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: false });
    expect(await auditOf('profile.avatar_reset')).toHaveLength(0);
    expect(
      await profileReportsDb(h).countDocuments({ targetUserId: target.userId, resolvedAt: null }),
    ).toBe(1);
    expect((await profileOf(target.userId))?.openReportCount).toBe(1);
  });

  it('club-reset: club: null, жалобы actioned, журнал; повтор — { reset: false } без журнала', async () => {
    await reportsOn(target, ['club']);
    expect((await mod('POST', `/${target.userId}/club-reset`, { reason: REASON })).body).toEqual({
      reset: true,
    });
    expect(await profileOf(target.userId)).toMatchObject({
      club: null,
      openReportCount: 0,
      updatedAt: h.clock.now(),
    });
    expect(
      await profileReportsDb(h).countDocuments({
        targetUserId: target.userId,
        resolution: 'actioned',
      }),
    ).toBe(1);
    const audit = await auditOf('profile.club_reset');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: REASON, details: { reportCount: 1 } });
    expect(JSON.stringify(audit)).not.toContain('Секретный клуб');

    expect((await mod('POST', `/${target.userId}/club-reset`, { reason: REASON })).body).toEqual({
      reset: false,
    });
    expect(await auditOf('profile.club_reset')).toHaveLength(1);
  });

  it('профиля нет — 404; organizer — 403; без сессии — 401; короткая причина — 400', async () => {
    for (const action of ['avatar-reset', 'club-reset']) {
      expect((await mod('POST', `/${uuidv7()}/${action}`, { reason: REASON })).status).toBe(404);
      expect((await mod('POST', `/${target.userId}/${action}`, { reason: 'ab' })).status).toBe(400);
      const organizer = await staff(h, `org-${action}@example.by`, 'organizer');
      expect(
        (
          await profileModerationCall(h, organizer.token, 'POST', `/${target.userId}/${action}`, {
            reason: REASON,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await profileModerationCall(h, undefined, 'POST', `/${target.userId}/${action}`, {
            reason: REASON,
          })
        ).status,
      ).toBe(401);
    }
    expect((await profileOf(target.userId))?.club).toBe('Секретный клуб');
  });

  it('лог: действие и модератор — без userId райдера, клуба и причины', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await mod('POST', `/${target.userId}/club-reset`, { reason: REASON });
      const lines = log.mock.calls.map((args) => String(args[0])).join('\n');
      expect(lines).toContain(`profile club reset by ${moderator.userId} reset=true`);
      expect(lines).not.toContain(target.userId);
      expect(lines).not.toContain('Секретный клуб');
      expect(lines).not.toContain(REASON);
    } finally {
      log.mockRestore();
    }
  });
});

describe('POST dismiss-reports (AC7)', () => {
  it('закрывает как dismissed, профиль не меняется (updatedAt тот же), журнал', async () => {
    await reportsOn(target, ['photo', 'name']);
    const before = await profileOf(target.userId);
    h.clock.advance(60_000);
    const res = await mod('POST', `/${target.userId}/dismiss-reports`, {
      reason: 'Нарушений нет',
      reportRevision: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: true });
    expect(await profileOf(target.userId)).toEqual({
      ...before,
      openReportCount: 0,
      openReasons: [],
    });
    expect(
      await profileReportsDb(h).countDocuments({
        targetUserId: target.userId,
        resolution: 'dismissed',
        resolvedBy: moderator.userId,
      }),
    ).toBe(2);
    const audit = await auditOf('profile.reports_dismissed');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      subject: { kind: 'rider', id: target.userId },
      reason: 'Нарушений нет',
      details: { reportCount: 2 },
    });
  });

  it('устаревший reportRevision (жалоба после чтения карточки) — 409 CONFLICT, жалобы открыты', async () => {
    await reportsOn(target, ['photo']);
    const detail = RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body);
    await reportsOn(target, ['club', 'spam']);
    const res = await mod('POST', `/${target.userId}/dismiss-reports`, {
      reason: 'Нарушений нет',
      reportRevision: detail.reportRevision,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT' });
    expect(
      await profileReportsDb(h).countDocuments({ targetUserId: target.userId, resolvedAt: null }),
    ).toBe(3);
    expect(await auditOf('profile.reports_dismissed')).toHaveLength(0);
  });

  it('открытых нет — { dismissed: false } без журнала; профиля нет — 404; без reportRevision — 400', async () => {
    await reportsOn(target, ['photo']);
    await mod('POST', `/${target.userId}/club-reset`, { reason: REASON });
    const res = await mod('POST', `/${target.userId}/dismiss-reports`, {
      reason: 'Нарушений нет',
      reportRevision: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false });
    expect(await auditOf('profile.reports_dismissed')).toHaveLength(0);
    expect(
      (
        await mod('POST', `/${uuidv7()}/dismiss-reports`, {
          reason: 'Нарушений нет',
          reportRevision: 0,
        })
      ).status,
    ).toBe(404);
    expect(
      (await mod('POST', `/${target.userId}/dismiss-reports`, { reason: 'Нарушений нет' })).status,
    ).toBe(400);
  });
});

describe('очередь по причине (profile-moderation-followups, AC1)', () => {
  it('?reason=name — только открытые «Имя», порядок и курсор как у общей; профиль в нескольких вкладках', async () => {
    const second = await publicRider(h, 'second@example.by', 'Борис');
    const third = await publicRider(h, 'third@example.by', 'Вера');
    await reportsOn(target, ['name', 'photo']);
    h.clock.advance(60_000);
    await reportsOn(second, ['club']);
    h.clock.advance(60_000);
    await reportsOn(third, ['name']);

    const first = RiderProfileModerationPage.parse((await mod('GET', '?reason=name&limit=1')).body);
    expect(first.items.map((row) => [row.userId, row.openReasons])).toEqual([
      [third.userId, ['name']],
    ]);
    const next = RiderProfileModerationPage.parse(
      (await mod('GET', `?reason=name&limit=1&cursor=${first.nextCursor}`)).body,
    );
    expect(next.items.map((row) => [row.userId, row.openReasons])).toEqual([
      [target.userId, ['photo', 'name']],
    ]);
    expect(next.nextCursor).toBeNull();
    const photo = RiderProfileModerationPage.parse((await mod('GET', '?reason=photo')).body);
    expect(photo.items.map((row) => row.userId)).toEqual([target.userId]);
    const all = RiderProfileModerationPage.parse((await mod('GET', '')).body);
    expect(all.items.map((row) => row.userId)).toEqual([
      third.userId,
      second.userId,
      target.userId,
    ]);
  });

  it('жалобы закрыты (сброс, «Отклонить») — профиль уходит из фильтра; reason=bad — 400', async () => {
    await reportsOn(target, ['name']);
    const second = await publicRider(h, 'second@example.by', 'Борис');
    await reportsOn(second, ['name']);
    await mod('POST', `/${target.userId}/club-reset`, { reason: REASON });
    await mod('POST', `/${second.userId}/dismiss-reports`, { reason: REASON, reportRevision: 1 });
    expect(RiderProfileModerationPage.parse((await mod('GET', '?reason=name')).body).items).toEqual(
      [],
    );
    const bad = await mod('GET', '?reason=bad');
    expect(bad.status).toBe(400);
  });

  it('план запроса: IXSCAN profiles_report_reason_queue_idx без стадии SORT', async () => {
    await reportsOn(target, ['name']);
    const plan = await profilesDb(h)
      .find({ $and: [{ openReportCount: { $gt: 0 } }, { openReasons: 'name' }] })
      .sort({ lastReportAt: -1, _id: -1 })
      .hint('profiles_report_reason_queue_idx')
      .limit(21)
      .explain('queryPlanner');
    const json = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(json).toContain('profiles_report_reason_queue_idx');
    expect(json).toContain('IXSCAN');
    expect(json).not.toContain('"stage":"SORT"');
  });

  it('план страницы с курсором и фильтром reason — тот же индекс, без стадии SORT (ревью pass 1, LOW)', async () => {
    await reportsOn(target, ['name']);
    // форма фильтра — как у `ProfileRepository.reportQueue` с `after` (keyset по lastReportAt, _id)
    const at = new Date('2026-10-30T10:00:00.000Z');
    const plan = await profilesDb(h)
      .find({
        $and: [
          { openReportCount: { $gt: 0 } },
          { openReasons: 'name' },
          {
            $or: [{ lastReportAt: { $lt: at } }, { lastReportAt: at, _id: { $lt: target.userId } }],
          },
        ],
      })
      .sort({ lastReportAt: -1, _id: -1 })
      .hint('profiles_report_reason_queue_idx')
      .limit(21)
      .explain('queryPlanner');
    const json = JSON.stringify(plan.queryPlanner.winningPlan);
    expect(json).toContain('profiles_report_reason_queue_idx');
    expect(json).toContain('IXSCAN');
    expect(json).not.toContain('"stage":"SORT"');
  });
});

describe('событие сброса для уведомления (profile-moderation-followups, AC3)', () => {
  it('сброс имени, фото и клуба (reset: true) — по одному событию; payload без причины и значений', async () => {
    await seedAvatar(h, target.userId);
    expect((await resetName()).body).toEqual({ reset: true });
    expect((await mod('POST', `/${target.userId}/avatar-reset`, { reason: REASON })).body).toEqual({
      reset: true,
    });
    expect((await mod('POST', `/${target.userId}/club-reset`, { reason: REASON })).body).toEqual({
      reset: true,
    });
    const events = await eventsOfType(h, PROFILE_FIELD_RESET);
    expect(events.map((event) => event.payload)).toEqual(
      ['name', 'avatar', 'club'].map((field) => ({
        userId: target.userId,
        field,
        resetAt: h.clock.now().toISOString(),
        avatarBlockedUntil: null,
      })),
    );
    const json = JSON.stringify(events);
    expect(json).not.toContain(REASON);
    expect(json).not.toContain('Анна К.');
    expect(json).not.toContain('Секретный клуб');
  });

  it('reset: false — без события', async () => {
    await mod('POST', `/${target.userId}/avatar-reset`, { reason: REASON });
    expect(await eventsOfType(h, PROFILE_FIELD_RESET)).toEqual([]);
  });
});

/** Сброс имени — `ProfileAdminController` (тот же модератор). */
const resetName = () =>
  panelCall(h, moderator.token, 'POST', `/v1/admin/profiles/${target.userId}/name-reset`, {
    reason: REASON,
  });

const AVATAR = '/v1/profile/avatar';
const ownProfile = async () =>
  ProfileView.parse((await call(h, 'GET', '/v1/profile', undefined, bearer(target.token))).body);
const uploadOwn = async () => {
  const response = await h.app.inject({
    method: 'PUT',
    url: AVATAR,
    headers: { 'content-type': 'application/octet-stream', ...bearer(target.token) },
    payload: await twoToneImage('png'),
  });
  return {
    status: response.statusCode,
    body: JSON.parse(response.body) as unknown,
    headers: response.headers,
  };
};
/** Часы стенда вперёд: access-токены райдера и сессия модератора истекают — новый вход обоих. */
async function advance(ms: number) {
  h.clock.advance(ms);
  const signedIn = await call(h, 'POST', '/v1/auth/session/sign-in', {
    email: 'target@example.by',
    password: 'long-enough',
  });
  const session = (signedIn.body as { session?: { accessToken?: string } }).session;
  if (!session?.accessToken) throw new Error(`sign-in: ${signedIn.status}`);
  target = { ...target, token: session.accessToken };
  moderator = { ...moderator, token: await panelSession(h, 'moderator@example.by') };
}
/** Фото и его сброс модератором; ответ сброса. */
async function avatarResetRound() {
  await seedAvatar(h, target.userId);
  return mod('POST', `/${target.userId}/avatar-reset`, { reason: REASON });
}

describe('запрет загрузки фото (profile-moderation-followups, AC5–AC6)', () => {
  it('3-й сброс за 180 дней — запрет на 30 дней: GET, карточка, журнал, событие; PUT — 409 до тела', async () => {
    await avatarResetRound();
    await advance(10 * DAY);
    await avatarResetRound();
    await advance(10 * DAY);
    expect((await ownProfile()).avatarUploadBlockedUntil).toBeNull();
    expect((await avatarResetRound()).body).toEqual({ reset: true });
    const until = new Date(h.clock.now().getTime() + 30 * DAY).toISOString();

    expect((await ownProfile()).avatarUploadBlockedUntil).toBe(until);
    const detail = RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body);
    expect(detail).toMatchObject({ avatarUploadBlockedUntil: until, avatarResetCount: 3 });
    const audit = await auditOf('profile.avatar_reset');
    // запрет включил только третий сброс
    expect(
      audit
        .sort((x, y) => x.at.getTime() - y.at.getTime())
        .map((entry) => entry.details?.avatarBlockedUntil ?? null),
    ).toEqual([null, null, until]);
    const events = await eventsOfType(h, PROFILE_FIELD_RESET);
    expect(
      events.map((event) => (event.payload as { avatarBlockedUntil: unknown }).avatarBlockedUntil),
    ).toEqual([null, null, until]);

    // RC-F5: все ответы ProfileView несут запрет
    const patched = await call(
      h,
      'PATCH',
      '/v1/profile',
      { club: 'Новый клуб' },
      bearer(target.token),
    );
    expect(ProfileView.parse(patched.body).avatarUploadBlockedUntil).toBe(until);
    const themed = await call(
      h,
      'PUT',
      '/v1/profile/theme',
      { themeId: 'classic' },
      bearer(target.token),
    );
    expect(ProfileView.parse(themed.body).avatarUploadBlockedUntil).toBe(until);
    const removed = await call(h, 'POST', `${AVATAR}/delete`, undefined, bearer(target.token));
    expect(removed.status).toBe(200);
    expect(ProfileView.parse(removed.body).avatarUploadBlockedUntil).toBe(until);

    // PUT: 409 до слота и тела — тело не дочитывается, слот не берётся
    const acquire = vi.spyOn(UploadSlots.prototype, 'tryAcquire');
    try {
      const held = heldUpload(h, AVATAR, bearer(target.token), 'PUT');
      const blocked = await held.response;
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({
        code: 'PROFILE_INVALID_STATE',
        details: { reason: 'avatar_blocked', until },
      });
      expect(blocked.headers['connection']).toBe('close');
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      acquire.mockRestore();
    }

    await advance(30 * DAY);
    expect((await ownProfile()).avatarUploadBlockedUntil).toBeNull();
    expect((await uploadOwn()).status).toBe(200);
  });

  it('2 сброса или 3 за > 180 дней — запрета нет', async () => {
    await avatarResetRound();
    await advance(100 * DAY);
    await avatarResetRound();
    expect((await ownProfile()).avatarUploadBlockedUntil).toBeNull();
    await advance(81 * DAY);
    await avatarResetRound();
    expect((await ownProfile()).avatarUploadBlockedUntil).toBeNull();
    const detail = RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body);
    expect(detail).toMatchObject({ avatarUploadBlockedUntil: null, avatarResetCount: 2 });
    expect((await uploadOwn()).status).toBe(200);
  });

  it('«Снять запрет»: загрузка работает, журнал без ПДн; история сохранена — следующий сброс снова запрещает', async () => {
    for (let i = 0; i < 3; i += 1) await avatarResetRound();
    const res = await mod('POST', `/${target.userId}/avatar-unblock`, {
      reason: 'Ошибка модератора',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unblocked: true });
    expect((await ownProfile()).avatarUploadBlockedUntil).toBeNull();
    const audit = await auditOf('profile.avatar_unblocked');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: moderator.userId },
      subject: { kind: 'rider', id: target.userId, label: `Участник ·${target.userId.slice(-6)}` },
      reason: 'Ошибка модератора',
    });
    expect(JSON.stringify(audit)).not.toContain('Анна К.');
    expect(
      RiderProfileModerationDetail.parse((await mod('GET', `/${target.userId}`)).body)
        .avatarResetCount,
    ).toBe(3);
    expect((await uploadOwn()).status).toBe(200);

    const again = await mod('POST', `/${target.userId}/avatar-unblock`, {
      reason: 'Ошибка модератора',
    });
    expect(again.body).toEqual({ unblocked: false });
    expect(await auditOf('profile.avatar_unblocked')).toHaveLength(1);

    await advance(DAY);
    await avatarResetRound();
    expect((await ownProfile()).avatarUploadBlockedUntil).toBe(
      new Date(h.clock.now().getTime() + 30 * DAY).toISOString(),
    );
  });

  it('«Снять запрет»: истёкший — { unblocked: false }; нет профиля — 404; organizer — 403; без сессии — 401', async () => {
    for (let i = 0; i < 3; i += 1) await avatarResetRound();
    await advance(31 * DAY);
    const body = { reason: 'Ошибка модератора' };
    expect((await mod('POST', `/${target.userId}/avatar-unblock`, body)).body).toEqual({
      unblocked: false,
    });
    expect(await auditOf('profile.avatar_unblocked')).toHaveLength(0);
    expect((await mod('POST', `/${uuidv7()}/avatar-unblock`, body)).status).toBe(404);
    expect((await mod('POST', `/${target.userId}/avatar-unblock`, { reason: 'ab' })).status).toBe(
      400,
    );
    const organizer = await staff(h, 'org@example.by', 'organizer');
    expect(
      (
        await profileModerationCall(
          h,
          organizer.token,
          'POST',
          `/${target.userId}/avatar-unblock`,
          body,
        )
      ).status,
    ).toBe(403);
    expect(
      (await profileModerationCall(h, undefined, 'POST', `/${target.userId}/avatar-unblock`, body))
        .status,
    ).toBe(401);
  });
});
