import { PanelInvitation } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate } from '../../../test/identity';
import {
  acceptInvitation,
  invitationToken,
  memberUser,
  panel,
  panelCall,
  panelSession,
  verifiedUser,
} from '../../../test/panel';
import { PanelInvitationsRepository } from './panel-invitations.repository';

/**
 * Гонки приглашений (AC7, §7, RC-15): ворота — `findLiveByTokenHash` (снимок до пароля) ждёт, пока другая операция
 * завершится целиком. Отрицательное доказательство — `lockPending` подменён чтением без условия и записи: обе
 * операции коммитятся.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1', PANEL_LINK_BASE: 'https://pokatim.example/admin/' });
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

const repository = () => h.app.get(PanelInvitationsRepository, { strict: false });

async function setup(role: 'admin' | 'moderator' = 'moderator') {
  const adminId = await memberUser(h, ADMIN, 'admin');
  const adminToken = await panelSession(h, ADMIN);
  const res = await panelCall(h, adminToken, 'POST', INVITATIONS, {
    email: INVITEE,
    displayName: 'Новый сотрудник',
    role,
  });
  const { id } = PanelInvitation.parse(res.body);
  const userId = await verifiedUser(h, INVITEE);
  return { adminId, adminToken, id, token: invitationToken(h, id), userId };
}

/** Принятие остановлено после снимка приглашения (до пароля и транзакции). */
function pauseAfterSnapshot() {
  const g = gate();
  const repo = repository();
  const original = repo.findLiveByTokenHash.bind(repo);
  vi.spyOn(repo, 'findLiveByTokenHash').mockImplementationOnce(async (...args) => {
    const doc = await original(...args);
    await g.wait();
    return doc;
  });
  return g;
}

/** «Принятие без замка»: `lockPending` — чтение документа без условия статуса и без записи. */
function lockPendingAsRead() {
  const repo = repository();
  vi.spyOn(repo, 'lockPending').mockImplementation((tx, id) => repo.findById(id, tx));
}

const acceptedCount = () => panel(h).audit.countDocuments({ action: 'panel.invitation_accepted' });

describe('принятие ↔ отзыв', () => {
  it('отзыв между снимком и транзакцией принятия — принятие 410, роли нет; журнал — только отзыв', async () => {
    const s = await setup();
    const g = pauseAfterSnapshot();
    const accepting = acceptInvitation(h, { token: s.token, email: INVITEE });
    await g.reached;
    expect((await panelCall(h, s.adminToken, 'POST', `${INVITATIONS}/${s.id}/revoke`)).status).toBe(
      204,
    );
    g.open();

    const res = await accepting;
    expect(res.status).toBe(410);
    expect(await panel(h).members.countDocuments({ _id: s.userId })).toBe(0);
    expect(await panel(h).invitations.findOne({ _id: s.id })).toMatchObject({ status: 'revoked' });
    expect(await acceptedCount()).toBe(0);
  });

  it('отрицательное доказательство: без lockPending обе коммитятся — сотрудник активен, приглашение отозвано', async () => {
    const s = await setup();
    lockPendingAsRead();
    const g = pauseAfterSnapshot();
    const accepting = acceptInvitation(h, { token: s.token, email: INVITEE });
    await g.reached;
    expect((await panelCall(h, s.adminToken, 'POST', `${INVITATIONS}/${s.id}/revoke`)).status).toBe(
      204,
    );
    g.open();

    expect((await accepting).status).toBe(200);
    expect(await panel(h).members.findOne({ _id: s.userId })).toMatchObject({ status: 'active' });
    expect(await panel(h).invitations.findOne({ _id: s.id })).toMatchObject({ status: 'revoked' });
    expect(await panel(h).audit.countDocuments({ action: 'panel.invitation_revoked' })).toBe(1);
    expect(await acceptedCount()).toBe(1);
  });
});

describe('принятие ↔ повторное приглашение', () => {
  const reinvite = (adminToken: string) =>
    panelCall(h, adminToken, 'POST', INVITATIONS, {
      email: INVITEE,
      displayName: 'Другое имя',
      role: 'organizer',
    });

  it('замена между снимком и транзакцией — прежняя ссылка 410, новое приглашение живо', async () => {
    const s = await setup();
    const g = pauseAfterSnapshot();
    const accepting = acceptInvitation(h, { token: s.token, email: INVITEE });
    await g.reached;
    const replaced = await reinvite(s.adminToken);
    expect(replaced.status).toBe(201);
    g.open();

    expect((await accepting).status).toBe(410);
    expect(await panel(h).members.countDocuments({ _id: s.userId })).toBe(0);
    expect(await panel(h).invitations.countDocuments({ status: 'pending' })).toBe(1);
    expect(await acceptedCount()).toBe(0);
  });

  it('отрицательное доказательство: без lockPending сотрудник активен по заменённой ссылке', async () => {
    const s = await setup();
    lockPendingAsRead();
    const g = pauseAfterSnapshot();
    const accepting = acceptInvitation(h, { token: s.token, email: INVITEE });
    await g.reached;
    expect((await reinvite(s.adminToken)).status).toBe(201);
    g.open();

    expect((await accepting).status).toBe(200);
    expect(await panel(h).members.findOne({ _id: s.userId })).toMatchObject({
      status: 'active',
      role: 'moderator',
    });
    expect(await panel(h).invitations.findOne({ _id: s.id })).toMatchObject({
      status: 'revoked',
      revokedReason: 'replaced',
    });
  });
});

describe('параллельные операции', () => {
  it('два принятия одного приглашения — одна активация и одна запись журнала, второе 409/410', async () => {
    const s = await setup();
    const g = gate();
    const repo = repository();
    const original = repo.findLiveByTokenHash.bind(repo);
    const spy = vi.spyOn(repo, 'findLiveByTokenHash').mockImplementation(async (...args) => {
      const doc = await original(...args);
      await g.wait();
      return doc;
    });
    const both = Promise.all([
      acceptInvitation(h, { token: s.token, email: INVITEE }),
      acceptInvitation(h, { token: s.token, email: INVITEE }),
    ]);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    g.open();

    const statuses = (await both).map((res) => res.status).sort();
    expect(statuses[0]).toBe(200);
    expect([409, 410]).toContain(statuses[1]);
    expect(await panel(h).members.countDocuments({ _id: s.userId })).toBe(1);
    expect(await acceptedCount()).toBe(1);
  });

  it('два приглашения одного адреса параллельно — оба 201, pending одно; путь повтора пройден', async () => {
    await memberUser(h, ADMIN, 'admin');
    const adminToken = await panelSession(h, ADMIN);
    const g = gate();
    const repo = repository();
    const close = repo.closePending.bind(repo);
    const closeSpy = vi.spyOn(repo, 'closePending').mockImplementation(async (...args) => {
      const count = await close(...args);
      await g.wait();
      return count;
    });
    const insertSpy = vi.spyOn(repo, 'insert');
    const body = { email: INVITEE, displayName: 'X', role: 'organizer' };
    const both = Promise.all([
      panelCall(h, adminToken, 'POST', INVITATIONS, body),
      panelCall(h, adminToken, 'POST', INVITATIONS, body),
    ]);
    await vi.waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(2));
    g.open();

    expect((await both).map((res) => res.status)).toEqual([201, 201]);
    expect(await panel(h).invitations.countDocuments({ status: 'pending' })).toBe(1);
    expect(await panel(h).invitations.countDocuments()).toBe(2);
    expect(insertSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('принятие admin-приглашения и понижение другого админа сериализуются на lockAdmins', async () => {
    const s = await setup('admin');
    const other = await memberUser(h, 'other@example.by', 'admin');
    const before = (await panel(h).meta.findOne({ _id: 'admins' }))?.version ?? 0;

    const [accepted, demoted] = await Promise.all([
      acceptInvitation(h, { token: s.token, email: INVITEE }),
      panelCall(h, s.adminToken, 'POST', `/v1/admin/members/${other}/role`, {
        role: 'moderator',
        reason: 'ротация',
      }),
    ]);
    expect(accepted.status).toBe(200);
    expect(demoted.status).toBe(200);
    expect((await panel(h).meta.findOne({ _id: 'admins' }))?.version).toBe(before + 2);
    expect(await panel(h).members.countDocuments({ role: 'admin', status: 'active' })).toBe(2);
  });
});
