import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { gate, untilBlocked } from '../../../test/identity';
import {
  memberUser,
  panel,
  panelCall,
  panelCookieValue,
  panelSession,
  panelSignIn,
  verifiedUser,
} from '../../../test/panel';
import { PanelRepository } from './panel.repository';

/**
 * Гонки панели (R7, `pokatim-tests.md`): два админа снимают друг друга (write skew на «последнем админе», замок
 * `panel_meta.admins` с отрицательным доказательством), две выдачи одному пользователю, вход ↔ снятие роли.
 */
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

const MEMBERS = '/v1/admin/members';
const repository = () => h.app.get(PanelRepository, { strict: false });

/**
 * Два админа параллельно снимают друг друга. Первая транзакция (A снимает B) встаёт на воротах после подсчёта
 * админов; вторая (B снимает A) идёт до упора: с замком она повторяется на `lockAdmins`, без замка — коммитится.
 */
async function mutualRevoke() {
  const a = await memberUser(h, 'a@example.by', 'admin');
  const b = await memberUser(h, 'b@example.by', 'admin');
  const tokenA = await panelSession(h, 'a@example.by');
  const tokenB = await panelSession(h, 'b@example.by');
  const target = repository();
  const count = target.countActiveAdmins.bind(target);
  const paused = gate();
  const countSpy = vi.spyOn(target, 'countActiveAdmins').mockImplementationOnce(async (tx) => {
    const admins = await count(tx);
    await paused.wait(); // снимок первой транзакции: 2 админа
    return admins;
  });
  const lockSpy = vi.spyOn(target, 'lockAdmins');

  const first = panelCall(h, tokenA, 'POST', `${MEMBERS}/${b}/revoke`, { reason: 'гонка А' });
  await paused.reached;
  const second = panelCall(h, tokenB, 'POST', `${MEMBERS}/${a}/revoke`, { reason: 'гонка Б' });
  // вторая либо упёрлась в замок первой (повторы lockAdmins), либо дошла до подсчёта (замка нет)
  await untilBlocked(second, () =>
    Promise.resolve(lockSpy.mock.calls.length >= 3 || countSpy.mock.calls.length >= 2),
  );
  paused.open();
  return { results: await Promise.all([first, second]), a, b };
}

describe('два админа снимают друг друга (R7, AC7)', () => {
  it('ровно одно изменение: второе — 409 PANEL_LAST_ADMIN, активный админ остаётся', async () => {
    const { results } = await mutualRevoke();

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409)?.body).toMatchObject({
      code: 'PANEL_LAST_ADMIN',
    });
    expect(await panel(h).members.countDocuments({ role: 'admin', status: 'active' })).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'panel.role_revoked' })).toBe(1);
  });

  it('отрицательное доказательство: без lockAdmins оба снятия проходят — 0 активных админов', async () => {
    vi.spyOn(PanelRepository.prototype, 'lockAdmins').mockResolvedValue(undefined);

    const { results } = await mutualRevoke();

    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await panel(h).members.countDocuments({ role: 'admin', status: 'active' })).toBe(0);
  });
});

describe('две параллельные выдачи одному пользователю (AC6)', () => {
  it('один документ и одна запись журнала: один 201, второй 409 PANEL_ALREADY_MEMBER', async () => {
    await memberUser(h, 'admin@example.by', 'admin');
    const token = await panelSession(h, 'admin@example.by');
    const userId = await verifiedUser(h, 'new@example.by');
    const body = { email: 'new@example.by', displayName: 'Новый', role: 'moderator' };

    const results = await Promise.all(
      Array.from({ length: 4 }, () => panelCall(h, token, 'POST', MEMBERS, body)),
    );

    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await panel(h).members.countDocuments({ _id: userId })).toBe(1);
    expect(
      await panel(h).audit.countDocuments({ action: 'panel.role_granted', targetUserId: userId }),
    ).toBe(1);
  });
});

describe('вход в панель ↔ снятие роли', () => {
  it('роль снята между проверкой членства и выдачей сессии — выданная сессия на первом запросе 401', async () => {
    await memberUser(h, 'admin@example.by', 'admin');
    const adminToken = await panelSession(h, 'admin@example.by');
    const userId = await memberUser(h, 'mod@example.by', 'moderator');
    const target = repository();
    const insert = target.insertSession.bind(target);
    const paused = gate();
    vi.spyOn(target, 'insertSession').mockImplementationOnce(async (tx, doc) => {
      await paused.wait(); // членство уже проверено
      return insert(tx, doc);
    });

    const signing = panelSignIn(h, 'mod@example.by');
    await paused.reached;
    // вход держит замок сотрудника (`lockMember`, ревью 2FA pass 2): снятие роли повторяется до его коммита
    const lockSpy = vi.spyOn(target, 'lockMember');
    const revoking = panelCall(h, adminToken, 'POST', `${MEMBERS}/${userId}/revoke`, {
      reason: 'снятие во время входа',
    });
    await untilBlocked(revoking, () => Promise.resolve(lockSpy.mock.calls.length >= 2));
    paused.open();
    const [res, revoked] = await Promise.all([signing, revoking]);
    expect(revoked.status).toBe(200);
    expect(res.status).toBe(200);

    const me = await panelCall(h, panelCookieValue(res), 'GET', '/v1/admin/session/me');
    expect(me.status).toBe(401);
    expect(await panel(h).sessions.countDocuments({ userId, revokedAt: null })).toBe(0);
  });
});
