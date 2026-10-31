import { PanelMember, PanelMemberList, Session } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, gate, register, signUpSession, userIdByEmail } from '../../../test/identity';
import {
  memberUser,
  panel,
  panelCall,
  panelRepository,
  panelSession,
  seedMember,
  seedTotp,
  verifiedUser,
} from '../../../test/panel';
import { PanelMembersService } from './panel-members.service';

/** «Сотрудники» и права ролей (S5): AC5–AC7 на реальном MongoDB RS. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
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

const ADMIN = 'admin@example.by';
const MEMBERS = '/v1/admin/members';
const AUDIT = '/v1/admin/audit';
const UNKNOWN_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const grant = (token: string, body: Record<string, unknown>) =>
  panelCall(h, token, 'POST', MEMBERS, body);
const changeRole = (token: string, userId: string, body: Record<string, unknown>) =>
  panelCall(h, token, 'POST', `${MEMBERS}/${userId}/role`, body);
const revoke = (token: string, userId: string, body: Record<string, unknown>) =>
  panelCall(h, token, 'POST', `${MEMBERS}/${userId}/revoke`, body);

/** Админ с сессией панели. */
async function admin() {
  const userId = await memberUser(h, ADMIN, 'admin');
  return { userId, token: await panelSession(h, ADMIN) };
}

/** Доверенное устройство сотрудника напрямую в БД (подготовка теста). */
const seedDevice = (userId: string) =>
  panel(h).devices.insertOne({
    _id: `device-${userId}`,
    tokenHash: `hash-${userId}`,
    userId,
    credentialsStamp: 'stamp',
    totpEpoch: 'epoch',
    createdAt: h.clock.now(),
    expiresAt: new Date(h.clock.now().getTime() + 86_400_000),
    version: 0,
  });

describe('права ролей (AC5)', () => {
  it('organizer: members, audit и мутации — 403; moderator: audit — 200, members — 403; admin — 200', async () => {
    const target = await memberUser(h, 'target@example.by', 'organizer');
    const roles = [
      ['organizer', { members: 403, audit: 403, mutation: 403 }],
      ['moderator', { members: 403, audit: 200, mutation: 403 }],
      ['admin', { members: 200, audit: 200, mutation: 200 }],
    ] as const;
    for (const [role, expected] of roles) {
      const email = `${role}@example.by`;
      await memberUser(h, email, role);
      const token = await panelSession(h, email);

      expect((await panelCall(h, token, 'GET', MEMBERS)).status, role).toBe(expected.members);
      expect((await panelCall(h, token, 'GET', AUDIT)).status, role).toBe(expected.audit);
      const mutations = [
        await grant(token, { email: 'x@example.by', displayName: 'X', role: 'organizer' }),
        await changeRole(token, target, { role: 'organizer', reason: 'проверка прав' }),
      ];
      for (const res of mutations) {
        if (expected.mutation === 403) {
          expect(res.status, role).toBe(403);
          expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
        } else {
          expect(res.status, role).not.toBe(403);
        }
      }
    }
  });

  it('без сессии панели — 401 на каждом маршруте; access JWT приложения не помогает', async () => {
    const session = await signUpSession(h, 'rider@example.com');
    const auth = bearer(Session.parse(session).accessToken);
    for (const [method, url] of [
      ['GET', MEMBERS],
      ['POST', MEMBERS],
      ['POST', `${MEMBERS}/${UNKNOWN_ID}/role`],
      ['POST', `${MEMBERS}/${UNKNOWN_ID}/revoke`],
      ['GET', AUDIT],
    ] as const) {
      const res = await call(h, method, url, method === 'POST' ? {} : undefined, auth);
      expect(res.status, url).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('выдача роли (AC6)', () => {
  it('подтверждённому пользователю — 201 active, журнал role_granted; список с e-mail', async () => {
    const actor = await admin();
    const userId = await verifiedUser(h, 'new@example.by');

    const res = await grant(actor.token, {
      email: ' NEW@example.by',
      displayName: '  Мария  ',
      role: 'moderator',
    });

    expect(res.status).toBe(201);
    expect(PanelMember.parse(res.body)).toEqual({
      userId,
      displayName: 'Мария',
      email: 'new@example.by',
      role: 'moderator',
      status: 'active',
      grantedAt: h.clock.now().toISOString(),
      revokedAt: null,
      totpEnabled: false,
    });
    expect(await panel(h).audit.findOne({ action: 'panel.role_granted' })).toMatchObject({
      actor: { kind: 'user', userId: actor.userId },
      targetUserId: userId,
      reason: null,
      details: { roleTo: 'moderator' },
    });
    const list = PanelMemberList.parse((await panelCall(h, actor.token, 'GET', MEMBERS)).body);
    expect(list.truncated).toBe(false);
    expect(list.items.map((item) => [item.email, item.role]).sort()).toEqual([
      [ADMIN, 'admin'],
      ['new@example.by', 'moderator'],
    ]);
  });

  it('неизвестный адрес — 404, неподтверждённый — 409 PANEL_USER_UNVERIFIED, уже член — 409 PANEL_ALREADY_MEMBER; без изменений', async () => {
    const actor = await admin();
    await register(h, { email: 'pending@example.by' });
    const body = (email: string) => ({ email, displayName: 'Кто-то', role: 'organizer' });

    const unknown = await grant(actor.token, body('nobody@example.by'));
    const unverified = await grant(actor.token, body('pending@example.by'));
    const member = await grant(actor.token, body(ADMIN));

    expect([unknown.status, unknown.body]).toEqual([
      404,
      expect.objectContaining({ code: 'NOT_FOUND' }),
    ]);
    expect(unverified.body).toMatchObject({ code: 'PANEL_USER_UNVERIFIED' });
    expect(unverified.status).toBe(409);
    expect(member.body).toMatchObject({ code: 'PANEL_ALREADY_MEMBER' });
    expect(await panel(h).members.countDocuments()).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'panel.role_granted' })).toBe(0);
  });

  it('повторная выдача после снятия — active с новой ролью и новым именем', async () => {
    const actor = await admin();
    const userId = await verifiedUser(h, 'back@example.by');
    await seedMember(h, userId, 'moderator', { status: 'revoked', displayName: 'Было' });

    const res = await grant(actor.token, {
      email: 'back@example.by',
      displayName: 'Стало',
      role: 'organizer',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      role: 'organizer',
      status: 'active',
      displayName: 'Стало',
      revokedAt: null,
    });
  });

  it('повторная выдача снятому с прежней 2FA (снят до удаления 2FA при снятии) — 2FA и устройства удалены', async () => {
    const actor = await admin();
    const userId = await verifiedUser(h, 'back@example.by');
    await seedMember(h, userId, 'moderator', { status: 'revoked' });
    await seedTotp(h, userId);
    await seedDevice(userId);

    const res = await grant(actor.token, {
      email: 'back@example.by',
      displayName: 'Стало',
      role: 'organizer',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'active', totpEnabled: false });
    expect(await panel(h).totp.countDocuments({ _id: userId })).toBe(0);
    expect(await panel(h).devices.countDocuments({ userId })).toBe(0);
  });

  it('тело с оператором, лишним ключом, неизвестной ролью — 400 без изменений', async () => {
    const actor = await admin();
    await verifiedUser(h, 'x@example.by');
    for (const body of [
      { email: { $ne: null }, displayName: 'X', role: 'admin' },
      { email: 'x@example.by', displayName: 'X', role: 'owner' },
      { email: 'x@example.by', displayName: 'X', role: 'admin', status: 'active' },
      { email: 'x@example.by', displayName: 'X\u0000', role: 'admin' },
    ]) {
      expect((await grant(actor.token, body)).status).toBe(400);
    }
    expect(await panel(h).members.countDocuments()).toBe(1);
  });
});

describe('смена и снятие роли (AC7)', () => {
  it('смена с причиной — права со следующего запроса без перевхода; журнал from/to и причина', async () => {
    const actor = await admin();
    const userId = await memberUser(h, 'mod@example.by', 'moderator');
    const modToken = await panelSession(h, 'mod@example.by');
    expect((await panelCall(h, modToken, 'GET', AUDIT)).status).toBe(200);

    const res = await changeRole(actor.token, userId, { role: 'organizer', reason: 'смена задач' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'organizer', status: 'active' });
    expect((await panelCall(h, modToken, 'GET', AUDIT)).status).toBe(403);
    expect(await panel(h).audit.findOne({ action: 'panel.role_changed' })).toMatchObject({
      actor: { kind: 'user', userId: actor.userId },
      targetUserId: userId,
      reason: 'смена задач',
      details: { roleFrom: 'moderator', roleTo: 'organizer' },
    });
  });

  it('снятие — все сессии панели отозваны в той же транзакции, сессия приложения жива', async () => {
    const actor = await admin();
    const session = Session.parse(await signUpSession(h, 'mod@example.by'));
    const userId = await userIdByEmail(h, 'mod@example.by');
    await seedMember(h, userId, 'moderator');
    const first = await panelSession(h, 'mod@example.by');
    const second = await panelSession(h, 'mod@example.by');

    const res = await revoke(actor.token, userId, { reason: 'ушла из команды' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'revoked', revokedAt: h.clock.now().toISOString() });
    const sessions = await panel(h).sessions.find({ userId }).toArray();
    expect(sessions.map((doc) => doc.revokedReason)).toEqual(['role_revoked', 'role_revoked']);
    for (const token of [first, second]) {
      expect((await panelCall(h, token, 'GET', '/v1/admin/session/me')).status).toBe(401);
    }
    const app = await call(
      h,
      'GET',
      '/v1/profile/onboarding',
      undefined,
      bearer(session.accessToken),
    );
    expect(app.status).toBe(200);
    expect(await panel(h).audit.findOne({ action: 'panel.role_revoked' })).toMatchObject({
      reason: 'ушла из команды',
      details: { roleFrom: 'moderator' },
    });
  });

  it('снятие удаляет 2FA и доверенные устройства сотрудника в той же транзакции; чужие — на месте', async () => {
    const actor = await admin();
    const userId = await memberUser(h, 'mod@example.by', 'moderator');
    const other = await memberUser(h, 'other@example.by', 'moderator');
    for (const id of [userId, other]) {
      await seedTotp(h, id);
      await seedDevice(id);
    }

    expect((await revoke(actor.token, userId, { reason: 'ушла из команды' })).status).toBe(200);

    expect(await panel(h).totp.countDocuments({ _id: userId })).toBe(0);
    expect(await panel(h).devices.countDocuments({ userId })).toBe(0);
    expect(await panel(h).totp.countDocuments({ _id: other })).toBe(1);
    expect(await panel(h).devices.countDocuments({ userId: other })).toBe(1);
  });

  it('себе — 409 PANEL_SELF_ACTION (смена и снятие), без изменений', async () => {
    const actor = await admin();
    const self = [
      await changeRole(actor.token, actor.userId, { role: 'moderator', reason: 'сама себе' }),
      await revoke(actor.token, actor.userId, { reason: 'сама себе' }),
    ];
    for (const res of self) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'PANEL_SELF_ACTION' });
    }
    expect(await panel(h).members.findOne({ _id: actor.userId })).toMatchObject({
      role: 'admin',
      status: 'active',
    });
  });

  it('последнего активного админа понизить или снять — 409 PANEL_LAST_ADMIN (актор, потерявший роль после гарда)', async () => {
    // по HTTP актор — всегда активный админ, поэтому последний админ — всегда цель «чужими руками»:
    // актор, снятый между гардом и транзакцией, или параллельное снятие (panel-races.int.test.ts)
    const onlyAdmin = await memberUser(h, ADMIN, 'admin');
    const staleActor = await memberUser(h, 'stale@example.by', 'moderator');
    const service = h.app.get(PanelMembersService, { strict: false });

    // по очереди: промис второй попытки не создаётся заранее (иначе его отказ — unhandled rejection под нагрузкой)
    for (const attempt of [
      () => service.changeRole(staleActor, onlyAdmin, { role: 'moderator', reason: 'понижение' }),
      () => service.revoke(staleActor, onlyAdmin, { reason: 'снятие' }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'PANEL_LAST_ADMIN', status: 409 });
    }
    expect(await panel(h).members.findOne({ _id: onlyAdmin })).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    expect(await panel(h).audit.countDocuments()).toBe(0);
  });

  it('при двух админах один понижает другого — 200; понижённый сразу теряет «Сотрудники» (403)', async () => {
    const actor = await admin();
    const other = await memberUser(h, 'other@example.by', 'admin');
    const otherToken = await panelSession(h, 'other@example.by');

    const res = await changeRole(actor.token, other, { role: 'moderator', reason: 'ротация' });

    expect(res.status).toBe(200);
    expect((await revoke(otherToken, actor.userId, { reason: 'ответ' })).status).toBe(403);
    expect(await panel(h).members.countDocuments({ role: 'admin', status: 'active' })).toBe(1);
  });

  it('без причины и с короткой причиной — 400; цель не UUID — 400; неактивный или неизвестный — 404', async () => {
    const actor = await admin();
    const userId = await memberUser(h, 'mod@example.by', 'moderator');
    expect((await changeRole(actor.token, userId, { role: 'organizer' })).status).toBe(400);
    expect((await revoke(actor.token, userId, {})).status).toBe(400);
    expect((await revoke(actor.token, userId, { reason: 'ок' })).status).toBe(400);
    expect((await revoke(actor.token, 'not-a-uuid', { reason: 'причина' })).status).toBe(400);
    expect((await revoke(actor.token, UNKNOWN_ID, { reason: 'причина' })).status).toBe(404);
    await revoke(actor.token, userId, { reason: 'причина' });
    expect((await revoke(actor.token, userId, { reason: 'причина' })).status).toBe(404);
    expect(
      (await changeRole(actor.token, userId, { role: 'admin', reason: 'причина' })).status,
    ).toBe(404);
  });
});

describe('сброс 2FA сотрудника (ADR-0024, D10)', () => {
  const reset = (token: string, userId: string, body: Record<string, unknown>) =>
    panelCall(h, token, 'POST', `${MEMBERS}/${userId}/totp/reset`, body);
  const REASON = { reason: 'потерян телефон' };

  it('admin сбрасывает модератору: 204, 2FA и устройства удалены, сессии цели отозваны, журнал с причиной; список — totpEnabled', async () => {
    const actor = await admin();
    const target = await memberUser(h, 'mod@example.by', 'moderator');
    const targetToken = await panelSession(h, 'mod@example.by');
    await seedTotp(h, target);
    await panel(h).devices.insertOne({
      _id: 'device-1',
      tokenHash: 'hash',
      userId: target,
      credentialsStamp: 'stamp',
      totpEpoch: 'epoch',
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 86_400_000),
      version: 0,
    });

    const list = PanelMemberList.parse((await panelCall(h, actor.token, 'GET', MEMBERS)).body);
    expect(list.items.find((item) => item.userId === target)?.totpEnabled).toBe(true);
    expect(list.items.find((item) => item.userId === actor.userId)?.totpEnabled).toBe(false);

    const res = await reset(actor.token, target, REASON);
    expect(res.status).toBe(204);
    expect(await panel(h).totp.countDocuments({ _id: target })).toBe(0);
    expect(await panel(h).devices.countDocuments({ userId: target })).toBe(0);
    expect(await panel(h).sessions.findOne({ userId: target })).toMatchObject({
      revokedReason: 'totp_reset',
    });
    expect((await panelCall(h, targetToken, 'GET', '/v1/admin/session/me')).status).toBe(401);
    expect(await panel(h).audit.findOne({ action: 'panel.totp_reset' })).toMatchObject({
      actor: { kind: 'user', userId: actor.userId },
      targetUserId: target,
      reason: 'потерян телефон',
    });
    // сессия актора жива
    expect((await panelCall(h, actor.token, 'GET', '/v1/admin/session/me')).status).toBe(200);

    // повтор — 2FA уже нет
    const again = await reset(actor.token, target, REASON);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'TOTP_NOT_ENABLED' });
  });

  it('себе — 409 PANEL_SELF_ACTION; без причины — 400; неизвестный — 404; moderator — 403', async () => {
    const actor = await admin();
    await seedTotp(h, actor.userId);
    const self = await reset(actor.token, actor.userId, REASON);
    expect(self.status).toBe(409);
    expect(self.body).toMatchObject({ code: 'PANEL_SELF_ACTION' });
    expect(await panel(h).totp.countDocuments({ _id: actor.userId })).toBe(1);

    const target = await memberUser(h, 'org@example.by', 'organizer');
    await seedTotp(h, target);
    expect((await reset(actor.token, target, {})).status).toBe(400);
    expect((await reset(actor.token, UNKNOWN_ID, REASON)).status).toBe(404);

    await memberUser(h, 'mod@example.by', 'moderator');
    const modToken = await panelSession(h, 'mod@example.by');
    expect((await reset(modToken, target, REASON)).status).toBe(403);
    expect(await panel(h).totp.countDocuments({ _id: target })).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'panel.totp_reset' })).toBe(0);
  });
});

describe('сброс 2FA перепроверяет актора под замком (ревью pass 5)', () => {
  it('актора понизили до moderator между гардом и сбросом — 403, 2FA цели на месте', async () => {
    const actor = await admin();
    const target = await memberUser(h, 'mod@example.by', 'moderator');
    await seedTotp(h, target);
    const g = gate();
    const repository = panelRepository(h);
    const list = repository.listMembersByIds.bind(repository);
    vi.spyOn(repository, 'listMembersByIds').mockImplementationOnce(async (...args) => {
      const docs = await list(...args);
      await g.wait();
      return docs;
    });
    const resetting = panelCall(h, actor.token, 'POST', `${MEMBERS}/${target}/totp/reset`, {
      reason: 'потерян телефон',
    });
    await g.reached;
    await panel(h).members.updateOne(
      { _id: actor.userId },
      { $set: { role: 'moderator' }, $inc: { version: 1 } },
    );
    g.open();

    const res = await resetting;
    expect(res.status).toBe(403);
    expect(await panel(h).totp.countDocuments({ _id: target })).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'panel.totp_reset' })).toBe(0);
  });
});
