import { Logger } from '@nestjs/common';
import { PanelInvitation, PanelInvitationList, PanelSignInResponse } from '@pokatim/contracts';
import { OUTBOX_COLLECTION } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  collections,
  confirm,
  gate,
  outboxEvents,
  register,
  userIdByEmail,
} from '../../../test/identity';
import {
  acceptInvitation,
  invitationToken,
  memberUser,
  panel,
  PANEL_TOTP_KEY_TEST,
  panelCall,
  panelCookie,
  panelCookieValue,
  panelSession,
  panelSignIn,
  seedMember,
  sendPanelEmails,
  verifiedUser,
} from '../../../test/panel';
import { PanelCredentials } from '../identity';
import { PANEL_INVITATION_EMAIL_REQUESTED } from './panel.events';
import { PanelInvitationsRepository } from './panel-invitations.repository';
import { PanelInvitationsService } from './panel-invitations.service';

/** Приглашения в команду (panel-invitations, ADR-0026) на реальном MongoDB RS и Redis. */
let h: Harness;
const LINK_BASE = 'https://pokatim.example/admin/';
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1', PANEL_LINK_BASE: LINK_BASE });
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
const INVITEE = 'new.member@example.by';
const INVITATIONS = '/v1/admin/invitations';
const UNKNOWN_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

async function admin() {
  const userId = await memberUser(h, ADMIN, 'admin');
  return { userId, token: await panelSession(h, ADMIN) };
}

const invite = (token: string, body: Record<string, unknown>) =>
  panelCall(h, token, 'POST', INVITATIONS, body);

/** Приглашение (тест знает, что успешно): id и токен ссылки. */
async function invited(
  adminToken: string,
  email = INVITEE,
  role: 'admin' | 'moderator' | 'organizer' = 'moderator',
) {
  const res = await invite(adminToken, { email, displayName: 'Новый сотрудник', role });
  if (res.status !== 201) throw new Error(`приглашение: ${res.status}`);
  const { id } = PanelInvitation.parse(res.body);
  return { id, token: invitationToken(h, id) };
}

const invitationDoc = (id: string) => panel(h).invitations.findOne({ _id: id });
const auditActions = async () =>
  (await panel(h).audit.find().sort({ _id: 1 }).toArray()).map((entry) => entry.action);

describe('приглашение без аккаунта → регистрация → принятие → вход (AC1, AC9)', () => {
  it('письмо со ссылкой; после регистрации в приложении — принятие паролем: сотрудник с ролью и сессия; журнал без e-mail', async () => {
    const actor = await admin();
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logs.push(String(message));
      });
    }

    const res = await invite(actor.token, {
      email: ' New.Member@Example.by ',
      displayName: 'Ольга',
      role: 'organizer',
    });
    expect(res.status).toBe(201);
    const invitation = PanelInvitation.parse(res.body);
    expect(invitation).toMatchObject({
      email: INVITEE,
      displayName: 'Ольга',
      role: 'organizer',
      invitedBy: 'Сотрудник admin',
      expired: false,
      emailState: 'pending',
    });
    expect(new Date(invitation.expiresAt).getTime() - h.clock.now().getTime()).toBe(7 * DAY);

    expect(await sendPanelEmails(h)).toEqual(['sent']);
    const token = invitationToken(h, invitation.id);
    const mail = h.mailer.sent.at(-1);
    expect(mail?.to).toBe(INVITEE);
    expect(mail?.text).toContain(`${LINK_BASE}invite#token=${token}`);
    expect(mail?.text).toContain('«Организатор»');
    expect((await invitationDoc(invitation.id))?.emailState).toBe('sent');

    // аккаунта ещё нет — принять нельзя (401 как у входа), приглашение живо
    expect((await acceptInvitation(h, { token, email: INVITEE })).status).toBe(401);

    await register(h, { email: INVITEE });
    await confirm(h, await activeLinkToken(h, INVITEE));
    const userId = await userIdByEmail(h, INVITEE);

    const accepted = await acceptInvitation(h, { token, email: INVITEE });
    expect(accepted.status).toBe(200);
    expect(PanelSignInResponse.parse(accepted.body)).toMatchObject({
      state: 'signedIn',
      me: { user: { id: userId, role: 'organizer', displayName: 'Ольга' } },
    });
    const cookie = panelCookieValue(accepted);
    expect(cookie).toBeDefined();
    expect((await panelCall(h, cookie, 'GET', '/v1/admin/session/me')).body).toMatchObject({
      user: { id: userId, role: 'organizer' },
    });

    expect(await panel(h).members.findOne({ _id: userId })).toMatchObject({
      role: 'organizer',
      status: 'active',
      displayName: 'Ольга',
    });
    expect(await invitationDoc(invitation.id)).toMatchObject({
      status: 'accepted',
      acceptedUserId: userId,
      email: null,
    });
    expect(await auditActions()).toEqual([
      'panel.signed_in',
      'panel.invitation_sent',
      'panel.invitation_accepted',
      'panel.signed_in',
    ]);
    expect(await panel(h).audit.findOne({ action: 'panel.invitation_accepted' })).toMatchObject({
      actor: { kind: 'user', userId },
      targetUserId: userId,
      subject: {
        kind: 'invitation',
        id: invitation.id,
        label: `Приглашение ·${invitation.id.slice(-6)}`,
      },
      details: { roleTo: 'organizer' },
    });
    expect(await panel(h).audit.findOne({ action: 'panel.invitation_sent' })).toMatchObject({
      actor: { kind: 'user', userId: actor.userId },
      targetUserId: null,
      details: { roleTo: 'organizer' },
    });
    // письмо о роли при принятии не ставится — человек принял сам
    expect(
      (await outboxEvents(h)).filter((e) => e.type === 'panel.role-email-requested'),
    ).toHaveLength(0);

    // AC9: e-mail — не в журнале, outbox и логах; сырого токена нет в БД
    const audit = JSON.stringify(await panel(h).audit.find().toArray());
    const outbox = JSON.stringify(await h.db.collection(OUTBOX_COLLECTION).find().toArray());
    const invitations = JSON.stringify(await panel(h).invitations.find().toArray());
    for (const dump of [audit, outbox, logs.join('\n')]) {
      expect(dump).not.toContain('new.member');
      expect(dump).not.toContain(token);
    }
    expect(invitations).not.toContain(token);
    expect((await invitationDoc(invitation.id))?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('прежняя сессия этого браузера при принятии отзывается (superseded), как у входа', async () => {
    const actor = await admin();
    const { token } = await invited(actor.token);
    await verifiedUser(h, INVITEE);

    const res = await acceptInvitation(h, { token, email: INVITEE }, panelCookie(actor.token));
    expect(res.status).toBe(200);
    expect(await panel(h).sessions.findOne({ userId: actor.userId })).toMatchObject({
      revokedReason: 'superseded',
    });
    expect((await panelCall(h, actor.token, 'GET', '/v1/admin/session/me')).status).toBe(401);
  });
});

describe('замена, отзыв, срок (AC2, AC3)', () => {
  it('повторное приглашение адреса гасит прежнюю ссылку (410), работает новая; pending — одно', async () => {
    const actor = await admin();
    const userId = await verifiedUser(h, INVITEE);
    const first = await invited(actor.token);
    const second = await invited(actor.token, INVITEE, 'organizer');

    expect(await invitationDoc(first.id)).toMatchObject({
      status: 'revoked',
      revokedReason: 'replaced',
      email: null,
    });
    expect(await panel(h).invitations.countDocuments({ status: 'pending' })).toBe(1);

    const stale = await acceptInvitation(h, { token: first.token, email: INVITEE });
    expect(stale.status).toBe(410);
    expect(stale.body).toMatchObject({ code: 'PANEL_INVITATION_INVALID' });

    const ok = await acceptInvitation(h, { token: second.token, email: INVITEE });
    expect(ok.status).toBe(200);
    expect(await panel(h).members.findOne({ _id: userId })).toMatchObject({ role: 'organizer' });
  });

  it('отозванное и принятое — 410; отзыв: 204, повтор — 404, журнал invitation_revoked', async () => {
    const actor = await admin();
    await verifiedUser(h, INVITEE);
    const revokedOne = await invited(actor.token);

    const revoke = await panelCall(
      h,
      actor.token,
      'POST',
      `${INVITATIONS}/${revokedOne.id}/revoke`,
    );
    expect(revoke.status).toBe(204);
    expect(
      (await panelCall(h, actor.token, 'POST', `${INVITATIONS}/${revokedOne.id}/revoke`)).status,
    ).toBe(404);
    expect(
      (await panelCall(h, actor.token, 'POST', `${INVITATIONS}/${UNKNOWN_ID}/revoke`)).status,
    ).toBe(404);
    expect(
      (await panelCall(h, actor.token, 'POST', `${INVITATIONS}/not-a-uuid/revoke`)).status,
    ).toBe(400);
    expect(await panel(h).audit.findOne({ action: 'panel.invitation_revoked' })).toMatchObject({
      actor: { kind: 'user', userId: actor.userId },
      subject: { kind: 'invitation', id: revokedOne.id },
      details: { roleTo: 'moderator' },
      reason: null,
    });
    expect(await invitationDoc(revokedOne.id)).toMatchObject({ status: 'revoked', email: null });
    expect((await acceptInvitation(h, { token: revokedOne.token, email: INVITEE })).status).toBe(
      410,
    );

    const acceptedOne = await invited(actor.token);
    expect((await acceptInvitation(h, { token: acceptedOne.token, email: INVITEE })).status).toBe(
      200,
    );
    const again = await acceptInvitation(h, { token: acceptedOne.token, email: INVITEE });
    expect(again.status).toBe(410);
    expect(
      (await panelCall(h, actor.token, 'POST', `${INVITATIONS}/${acceptedOne.id}/revoke`)).status,
    ).toBe(404);
  });

  it('истёкшее (> 7 суток) — 410, хотя документ ещё pending; в списке — expired; его можно отозвать', async () => {
    const actor = await admin();
    await verifiedUser(h, INVITEE);
    const { id, token } = await invited(actor.token);
    h.clock.advance(7 * DAY);

    const res = await acceptInvitation(h, { token, email: INVITEE });
    expect(res.status).toBe(410);
    expect(await invitationDoc(id)).toMatchObject({ status: 'pending' });
    expect(await panel(h).members.countDocuments()).toBe(1);

    const adminToken = await panelSession(h, ADMIN);
    const list = PanelInvitationList.parse(
      (await panelCall(h, adminToken, 'GET', INVITATIONS)).body,
    );
    expect(list.items).toEqual([expect.objectContaining({ id, expired: true })]);
    expect((await panelCall(h, adminToken, 'POST', `${INVITATIONS}/${id}/revoke`)).status).toBe(
      204,
    );
  });

  it('новое приглашение гасит и истёкшее pending того же адреса (RC-5)', async () => {
    const actor = await admin();
    const old = await invited(actor.token);
    h.clock.advance(8 * DAY);
    const adminToken = await panelSession(h, ADMIN);
    const fresh = await invited(adminToken);
    expect(await invitationDoc(old.id)).toMatchObject({
      status: 'revoked',
      revokedReason: 'replaced',
    });
    expect(await invitationDoc(fresh.id)).toMatchObject({ status: 'pending', email: INVITEE });
  });
});

describe('проверки принятия (AC4, AC5, RC-2, RC-3, RC-11, RC-17)', () => {
  it('чужой аккаунт (другой e-mail) — 409 PANEL_INVITATION_EMAIL_MISMATCH, роль не выдана, приглашение живо', async () => {
    const actor = await admin();
    const { id, token } = await invited(actor.token);
    await verifiedUser(h, 'other@example.by');

    const res = await acceptInvitation(h, { token, email: 'other@example.by' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PANEL_INVITATION_EMAIL_MISMATCH' });
    expect(await panel(h).members.countDocuments()).toBe(1);
    expect(await invitationDoc(id)).toMatchObject({ status: 'pending' });
  });

  it('неверный пароль — 401 INVALID_CREDENTIALS; счётчики signin-* общие со входом (5 неверных — вход 429)', async () => {
    const actor = await admin();
    const { token } = await invited(actor.token);
    await verifiedUser(h, INVITEE);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await acceptInvitation(h, { token, email: INVITEE, password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    const signIn = await panelSignIn(h, INVITEE);
    expect(signIn.status).toBe(429);
    expect(signIn.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('мусорный токен — 410 до пароля: счётчики signin-* не списываются; IP-лимит принятия — 429', async () => {
    await memberUser(h, ADMIN, 'admin');
    const garbage = 'g'.repeat(43);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await acceptInvitation(h, { token: garbage, email: ADMIN, password: 'wrong' });
      expect(res.status).toBe(410);
    }
    expect((await acceptInvitation(h, { token: garbage, email: ADMIN })).status).toBe(429);
    // 20 попыток с тем же адресом и IP не тронули лимиты входа (e-mail+IP — 5 за 15 мин)
    expect((await panelSignIn(h, ADMIN)).status).toBe(200);
  });

  it('тело — strictObject: лишние ключи и токен не 43 символа — 400', async () => {
    expect((await acceptInvitation(h, { token: 'short', email: INVITEE })).status).toBe(400);
    expect(
      (
        await acceptInvitation(h, {
          token: 'g'.repeat(43),
          email: INVITEE,
          ...({ role: 'admin' } as object),
        })
      ).status,
    ).toBe(400);
  });

  it('неподтверждённый аккаунт — verificationRequired, приглашение не тронуто', async () => {
    const actor = await admin();
    const { id, token } = await invited(actor.token);
    await register(h, { email: INVITEE });

    const res = await acceptInvitation(h, { token, email: INVITEE });
    expect(res.status).toBe(200);
    expect(PanelSignInResponse.parse(res.body).state).toBe('verificationRequired');
    expect(await invitationDoc(id)).toMatchObject({ status: 'pending' });
    expect(await panel(h).members.countDocuments()).toBe(1);
  });

  it('уже активный член — 409 PANEL_ALREADY_MEMBER, приглашение остаётся pending (RC-11)', async () => {
    const actor = await admin();
    const { id, token } = await invited(actor.token);
    const userId = await verifiedUser(h, INVITEE);
    await seedMember(h, userId, 'organizer');

    const res = await acceptInvitation(h, { token, email: INVITEE });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PANEL_ALREADY_MEMBER' });
    expect(await invitationDoc(id)).toMatchObject({ status: 'pending' });
    expect(await panel(h).members.findOne({ _id: userId })).toMatchObject({ role: 'organizer' });
  });

  it('снятый сотрудник — повторная активация с ролью и именем приглашения', async () => {
    const actor = await admin();
    const userId = await verifiedUser(h, INVITEE);
    await seedMember(h, userId, 'organizer', { status: 'revoked', displayName: 'Старое имя' });
    const { token } = await invited(actor.token, INVITEE, 'moderator');

    expect((await acceptInvitation(h, { token, email: INVITEE })).status).toBe(200);
    expect(await panel(h).members.findOne({ _id: userId })).toMatchObject({
      status: 'active',
      role: 'moderator',
      displayName: 'Новый сотрудник',
      revokedAt: null,
    });
  });

  it('аккаунт удалён между проверкой пароля и принятием — 401, роли нет (RC-3)', async () => {
    const actor = await admin();
    const { id, token } = await invited(actor.token);
    const userId = await verifiedUser(h, INVITEE);
    const g = gate();
    const credentials = h.app.get(PanelCredentials, { strict: false });
    const verify = credentials.verify.bind(credentials);
    vi.spyOn(credentials, 'verify').mockImplementationOnce(async (...args) => {
      const result = await verify(...args);
      await g.wait();
      return result;
    });

    const accepting = acceptInvitation(h, { token, email: INVITEE });
    await g.reached;
    await collections(h).users.updateOne(
      { _id: userId },
      { $set: { deletedAt: h.clock.now() }, $inc: { version: 1 } },
    );
    g.open();

    const res = await accepting;
    expect(res.status).toBe(401);
    expect(await panel(h).members.countDocuments({ _id: userId })).toBe(0);
    expect(await invitationDoc(id)).toMatchObject({ status: 'pending' });
  });
});

describe('права и список (AC8, RC-10)', () => {
  it('moderator и organizer — 403 на список, приглашение и отзыв; admin — 200/201/204', async () => {
    const actor = await admin();
    const { id } = await invited(actor.token);
    for (const role of ['moderator', 'organizer'] as const) {
      const email = `${role}@example.by`;
      await memberUser(h, email, role);
      const token = await panelSession(h, email);
      expect((await panelCall(h, token, 'GET', INVITATIONS)).status, role).toBe(403);
      expect(
        (await invite(token, { email: 'x@example.by', displayName: 'X', role: 'organizer' }))
          .status,
        role,
      ).toBe(403);
      expect((await panelCall(h, token, 'POST', `${INVITATIONS}/${id}/revoke`)).status, role).toBe(
        403,
      );
    }
    expect(await panel(h).invitations.countDocuments()).toBe(1);
    expect((await panelCall(h, undefined, 'GET', INVITATIONS)).status).toBe(401);
  });

  it('список: только pending, новые сверху, «пригласил» — имя, emailState; закрытые не видны', async () => {
    const actor = await admin();
    const a = await invited(actor.token, 'a@example.by');
    h.clock.advance(1000);
    const b = await invited(actor.token, 'b@example.by', 'organizer');
    const c = await invited(actor.token, 'c@example.by');
    await panelCall(h, actor.token, 'POST', `${INVITATIONS}/${c.id}/revoke`);

    const list = PanelInvitationList.parse(
      (await panelCall(h, actor.token, 'GET', INVITATIONS)).body,
    );
    expect(list.truncated).toBe(false);
    expect(list.items.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(list.items[0]).toMatchObject({
      email: 'b@example.by',
      role: 'organizer',
      invitedBy: 'Сотрудник admin',
      emailState: 'pending',
      expired: false,
    });
  });

  it('адрес активного члена — 409 PANEL_ALREADY_MEMBER без записи; неверное тело — 400', async () => {
    const actor = await admin();
    const res = await invite(actor.token, { email: ADMIN, displayName: 'Я', role: 'moderator' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PANEL_ALREADY_MEMBER' });
    expect(await panel(h).invitations.countDocuments()).toBe(0);
    expect(
      (await invite(actor.token, { email: 'x', displayName: 'X', role: 'admin' })).status,
    ).toBe(400);
    expect(
      (await invite(actor.token, { email: 'x@example.by', displayName: 'X', role: 'owner' }))
        .status,
    ).toBe(400);
  });

  it('лимит приглашений на сотрудника — 30 в час, 31-е — 429 без записи (RC-9)', async () => {
    const actor = await admin();
    for (let n = 0; n < 30; n += 1) await invited(actor.token, `n${n}@example.by`);
    const res = await invite(actor.token, {
      email: 'over@example.by',
      displayName: 'X',
      role: 'organizer',
    });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await panel(h).invitations.countDocuments()).toBe(30);
  });

  it('нет базы ссылок панели — 503 PANEL_INVITATIONS_UNAVAILABLE без записи', async () => {
    const actor = await admin();
    const saved = h.env.PANEL_LINK_BASE;
    h.env.PANEL_LINK_BASE = undefined;
    try {
      const res = await invite(actor.token, {
        email: INVITEE,
        displayName: 'X',
        role: 'organizer',
      });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'PANEL_INVITATIONS_UNAVAILABLE' });
    } finally {
      h.env.PANEL_LINK_BASE = saved;
    }
    expect(await panel(h).invitations.countDocuments()).toBe(0);
    expect(
      (await outboxEvents(h)).filter((e) => e.type === PANEL_INVITATION_EMAIL_REQUESTED),
    ).toHaveLength(0);
  });

  it('событие outbox — только id приглашения; токен — HMAC, в БД — sha256 (AC9)', async () => {
    const actor = await admin();
    const { id, token } = await invited(actor.token);
    const events = (await outboxEvents(h)).filter(
      (e) => e.type === PANEL_INVITATION_EMAIL_REQUESTED,
    );
    expect(events.map((e) => e.payload)).toEqual([{ invitationId: id }]);
    const doc = await invitationDoc(id);
    expect(doc?.tokenHash).not.toBe(token);
    expect(await h.app.get(PanelInvitationsRepository, { strict: false }).findById(id)).toEqual(
      doc,
    );
  });
});

describe('обязательная 2FA: принятие admin-приглашения без 2FA → подключение (ADR-0024)', () => {
  let t: Harness;
  beforeAll(async () => {
    t = await createHarness({
      TRUST_PROXY: '1',
      PANEL_LINK_BASE: LINK_BASE,
      PANEL_TOTP_KEY: PANEL_TOTP_KEY_TEST,
      PANEL_TOTP_ENFORCED: 'true',
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('admin без 2FA — totpSetupRequired, член уже активен', async () => {
    await t.reset();
    const actorId = await verifiedUser(t, ADMIN);
    await seedMember(t, actorId, 'admin');
    // сессия admin при обязательной 2FA требует подключения — приглашение создаётся сервисом стенда напрямую
    const service = t.app.get(PanelInvitationsService, { strict: false });
    const created = await service.invite(
      { userId: actorId, sessionId: UNKNOWN_ID, role: 'admin', permissions: [] },
      { email: INVITEE, displayName: 'Новый админ', role: 'admin' },
    );
    const userId = await verifiedUser(t, INVITEE);

    const res = await acceptInvitation(t, {
      token: invitationToken(t, created.id),
      email: INVITEE,
    });
    expect(res.status).toBe(200);
    expect(PanelSignInResponse.parse(res.body).state).toBe('totpSetupRequired');
    expect(await panel(t).members.findOne({ _id: userId })).toMatchObject({
      role: 'admin',
      status: 'active',
    });
  });
});
