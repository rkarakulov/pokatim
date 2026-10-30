import { PanelInvitation, PanelInvitationList } from '@pokatim/contracts';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { collections, outboxEvents } from '../../../test/identity';
import {
  invitationToken,
  memberUser,
  panel,
  panelCall,
  panelSession,
  sendPanelEmails,
  verifiedUser,
} from '../../../test/panel';
import { PANEL_INVITATION_EMAIL_REQUESTED, PANEL_ROLE_EMAIL_REQUESTED } from './panel.events';

/** Письма панели (AC6, AC12): приглашение и письма о роли — процессор очереди `panel-email` напрямую. */
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
const STAFF = 'staff@example.by';
const INVITATIONS = '/v1/admin/invitations';
const MEMBERS = '/v1/admin/members';
const REASON = 'Секретная причина для журнала';

async function admin() {
  await memberUser(h, ADMIN, 'admin');
  return panelSession(h, ADMIN);
}

async function invite(token: string, email = STAFF) {
  const res = await panelCall(h, token, 'POST', INVITATIONS, {
    email,
    displayName: 'Ольга <script>',
    role: 'moderator',
  });
  return PanelInvitation.parse(res.body);
}

const roleEvents = async () =>
  (await outboxEvents(h)).filter((e) => e.type === PANEL_ROLE_EMAIL_REQUESTED);

describe('письмо-приглашение', () => {
  it('тема, роль, «действует до» по Минску, ссылка с #token=; повтор задачи — второе письмо с той же ссылкой', async () => {
    const token = await admin();
    const invitation = await invite(token);

    expect(await sendPanelEmails(h)).toEqual(['sent']);
    const mail = h.mailer.sent.at(-1);
    const link = `${LINK_BASE}invite#token=${invitationToken(h, invitation.id)}`;
    expect(mail).toMatchObject({ to: STAFF, subject: 'Приглашение в команду «Покатим»' });
    expect(mail?.text).toContain('«Модератор»');
    // 2026 по часам стенда + 7 суток, время по Минску
    expect(mail?.text).toMatch(
      /действует до \d{1,2} [а-я]+ \d{4} г\. в \d{2}:\d{2} по минскому времени/,
    );
    expect(mail?.text).toContain(link);
    expect(mail?.html).toContain(link);
    // имени в панели и пригласившего в письме нет
    expect(mail?.html).not.toContain('Ольга');

    expect(await sendPanelEmails(h)).toEqual(['sent']);
    expect(h.mailer.sent.at(-1)?.text).toContain(link);
    expect(h.mailer.sent.filter((m) => m.to === STAFF)).toHaveLength(2);
  });

  it('отозванное или заменённое до отправки — skipped, письма нет', async () => {
    const token = await admin();
    const invitation = await invite(token);
    await panelCall(h, token, 'POST', `${INVITATIONS}/${invitation.id}/revoke`);

    expect(await sendPanelEmails(h)).toEqual(['skipped']);
    expect(h.mailer.sent.filter((m) => m.to === STAFF)).toHaveLength(0);
  });

  it('сбой последней попытки — emailState failed, в списке «Письмо не отправлено»; повтор приглашения — новое pending', async () => {
    const token = await admin();
    const invitation = await invite(token);

    h.mailer.failNext();
    await expect(sendPanelEmails(h, { attemptsMade: 0 })).rejects.toThrow();
    expect((await panel(h).invitations.findOne({ _id: invitation.id }))?.emailState).toBe(
      'pending',
    );
    h.mailer.failNext();
    await expect(sendPanelEmails(h, { attemptsMade: 4 })).rejects.toThrow();
    expect((await panel(h).invitations.findOne({ _id: invitation.id }))?.emailState).toBe('failed');
    const list = PanelInvitationList.parse((await panelCall(h, token, 'GET', INVITATIONS)).body);
    expect(list.items[0]).toMatchObject({ id: invitation.id, emailState: 'failed' });

    const again = await invite(token);
    expect(again.emailState).toBe('pending');
    expect(again.id).not.toBe(invitation.id);
  });

  it('событие — только id приглашения', async () => {
    const token = await admin();
    const invitation = await invite(token);
    const events = (await outboxEvents(h)).filter(
      (e) => e.type === PANEL_INVITATION_EMAIL_REQUESTED,
    );
    expect(events.map((e) => e.payload)).toEqual([{ invitationId: invitation.id }]);
  });
});

describe('письма о роли', () => {
  it('выдача, смена и снятие — три письма сотруднику без причины, кнопка «Открыть панель»', async () => {
    const token = await admin();
    const userId = await verifiedUser(h, STAFF);
    await panelCall(h, token, 'POST', MEMBERS, {
      email: STAFF,
      displayName: 'Ольга',
      role: 'organizer',
    });
    await panelCall(h, token, 'POST', `${MEMBERS}/${userId}/role`, {
      role: 'moderator',
      reason: REASON,
    });
    await panelCall(h, token, 'POST', `${MEMBERS}/${userId}/revoke`, { reason: REASON });

    const events = await roleEvents();
    expect(events).toHaveLength(3);
    const auditIds = (
      await panel(h).audit.find({ targetUserId: userId }).sort({ _id: 1 }).toArray()
    ).map((entry) => entry._id);
    expect(events.map((e) => e.payload)).toEqual(auditIds.map((auditId) => ({ auditId })));

    expect(await sendPanelEmails(h, { type: PANEL_ROLE_EMAIL_REQUESTED })).toEqual([
      'sent',
      'sent',
      'sent',
    ]);
    const mails = h.mailer.sent.filter((m) => m.to === STAFF);
    expect(mails.map((m) => m.subject)).toEqual([
      'Вам выдана роль в панели «Протокол»',
      'Ваша роль в панели «Протокол» изменена',
      'Ваша роль в панели «Протокол» снята',
    ]);
    expect(mails[0]?.text).toContain('Вам выдана роль «Организатор»');
    expect(mails[1]?.text).toContain('Ваша роль изменена: «Организатор» → «Модератор»');
    expect(mails[2]?.text).toContain('Ваша роль «Модератор» снята');
    for (const mail of mails) {
      expect(mail.html).toContain(`href="${LINK_BASE}"`);
      expect(mail.text + mail.html).not.toContain(REASON);
    }
    expect(JSON.stringify(events)).not.toContain(STAFF);
  });

  it('без базы ссылок панели — письмо без кнопки', async () => {
    const token = await admin();
    await verifiedUser(h, STAFF);
    await panelCall(h, token, 'POST', MEMBERS, {
      email: STAFF,
      displayName: 'О',
      role: 'organizer',
    });
    const saved = h.env.PANEL_LINK_BASE;
    h.env.PANEL_LINK_BASE = undefined;
    try {
      expect(await sendPanelEmails(h, { type: PANEL_ROLE_EMAIL_REQUESTED })).toEqual(['sent']);
    } finally {
      h.env.PANEL_LINK_BASE = saved;
    }
    expect(h.mailer.sent.at(-1)?.html).not.toContain('Открыть панель');
  });

  it('удалённый к отправке аккаунт — skipped', async () => {
    const token = await admin();
    const userId = await verifiedUser(h, STAFF);
    await panelCall(h, token, 'POST', MEMBERS, {
      email: STAFF,
      displayName: 'О',
      role: 'organizer',
    });
    await collections(h).users.updateOne({ _id: userId }, { $set: { deletedAt: h.clock.now() } });

    expect(await sendPanelEmails(h, { type: PANEL_ROLE_EMAIL_REQUESTED })).toEqual(['skipped']);
    expect(h.mailer.sent.filter((m) => m.to === STAFF)).toHaveLength(0);
  });

  it('смена на ту же роль — без записи и без события', async () => {
    const token = await admin();
    const userId = await memberUser(h, STAFF, 'organizer');
    const res = await panelCall(h, token, 'POST', `${MEMBERS}/${userId}/role`, {
      role: 'organizer',
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(await roleEvents()).toHaveLength(0);
  });

  it('сбой записи outbox откатывает выдачу роли (событие в той же транзакции)', async () => {
    const token = await admin();
    const userId = await verifiedUser(h, STAFF);
    vi.spyOn(MongoOutboxWriter.prototype, 'append').mockRejectedValueOnce(new Error('outbox down'));

    const res = await panelCall(h, token, 'POST', MEMBERS, {
      email: STAFF,
      displayName: 'О',
      role: 'organizer',
    });
    expect(res.status).toBe(500);
    expect(await panel(h).members.countDocuments({ _id: userId })).toBe(0);
    expect(await panel(h).audit.countDocuments({ action: 'panel.role_granted' })).toBe(0);
  });
});
