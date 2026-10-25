import { AuditPage } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { memberUser, panel, panelCall, panelSession, verifiedUser } from '../../../test/panel';
import { MongoTransactions } from '../../db';
import { PanelAudit } from './panel-audit';
import { PanelDirectory } from './panel-directory';

/** Журнал действий (AC8): одна запись на действие, откат — без записи, чтение с курсором и фильтрами, без ПДн. */
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

const AUDIT = '/v1/admin/audit';
const MEMBERS = '/v1/admin/members';

async function page(token: string, query = '') {
  const res = await panelCall(h, token, 'GET', `${AUDIT}${query}`);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return AuditPage.parse(res.body);
}

/** Админ выдаёт роль, меняет её, снимает; модератор входит и выходит — по записи на действие. */
async function scenario() {
  const adminId = await memberUser(h, 'admin@example.by', 'admin');
  const token = await panelSession(h, 'admin@example.by');
  const modId = await verifiedUser(h, 'mod@example.by');
  h.clock.advance(MINUTE);
  await panelCall(h, token, 'POST', MEMBERS, {
    email: 'mod@example.by',
    displayName: 'Мария',
    role: 'moderator',
  });
  h.clock.advance(MINUTE);
  const modToken = await panelSession(h, 'mod@example.by');
  await panelCall(h, modToken, 'POST', '/v1/admin/session/sign-out', {});
  h.clock.advance(MINUTE);
  await panelCall(h, token, 'POST', `${MEMBERS}/${modId}/role`, {
    role: 'organizer',
    reason: 'смена задач',
  });
  h.clock.advance(MINUTE);
  await panelCall(h, token, 'POST', `${MEMBERS}/${modId}/revoke`, { reason: 'ушла из команды' });
  return { adminId, modId, token };
}

describe('журнал панели (AC8)', () => {
  it('каждое действие — ровно одна запись: кто, что, когда (CLOCK), над кем, причина; новые сверху', async () => {
    const start = h.clock.now().getTime();
    const { adminId, modId, token } = await scenario();

    const { items, nextCursor } = await page(token);

    expect(nextCursor).toBeNull();
    expect(
      items.map((entry) => [
        entry.action,
        entry.actor.kind === 'user' ? entry.actor.displayName : 'cli',
        entry.target?.displayName ?? null,
        entry.reason,
        entry.details,
      ]),
    ).toEqual([
      [
        'panel.role_revoked',
        'Сотрудник admin',
        'Мария',
        'ушла из команды',
        { roleFrom: 'organizer' },
      ],
      [
        'panel.role_changed',
        'Сотрудник admin',
        'Мария',
        'смена задач',
        { roleFrom: 'moderator', roleTo: 'organizer' },
      ],
      ['panel.signed_out', 'Мария', null, null, null],
      ['panel.signed_in', 'Мария', null, null, null],
      ['panel.role_granted', 'Сотрудник admin', 'Мария', null, { roleTo: 'moderator' }],
      ['panel.signed_in', 'Сотрудник admin', null, null, null],
    ]);
    expect(items.map((entry) => Date.parse(entry.at) - start)).toEqual([
      4 * MINUTE,
      3 * MINUTE,
      2 * MINUTE,
      2 * MINUTE,
      MINUTE,
      0,
    ]);
    expect(items[0]?.actor).toEqual({
      kind: 'user',
      userId: adminId,
      displayName: 'Сотрудник admin',
    });
    expect(items[0]?.target).toEqual({ userId: modId, displayName: 'Мария' });
  });

  it('ни в документе, ни в ответе — e-mail и IP', async () => {
    const { token } = await scenario();
    const docs = JSON.stringify(await panel(h).audit.find().toArray());
    const body = JSON.stringify(await page(token));
    for (const text of [docs, body]) {
      expect(text).not.toMatch(/@example\.by/);
      expect(text).not.toMatch(/198\.51\.100/);
    }
  });

  it('курсор и фильтры: страницы по 2 без пропусков и повторов; action, actorUserId, targetUserId', async () => {
    const { adminId, modId, token } = await scenario();
    const all = (await page(token)).items.map((entry) => entry.id);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next: AuditPage = await page(token, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...next.items.map((entry) => entry.id));
      cursor = next.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);

    expect((await page(token, '?action=panel.signed_in')).items).toHaveLength(2);
    const byActor = await page(token, `?actorUserId=${modId}`);
    expect(byActor.items.map((entry) => entry.action)).toEqual([
      'panel.signed_out',
      'panel.signed_in',
    ]);
    const byTarget = await page(token, `?targetUserId=${modId}&action=panel.role_changed`);
    expect(byTarget.items).toHaveLength(1);
    expect((await page(token, `?actorUserId=${adminId}`)).items).toHaveLength(4);
  });

  it('инъекция и мусор в query — 400: оператор, не UUID, limit 0/101, неизвестное действие', async () => {
    const { token } = await scenario();
    for (const query of [
      '?action[$ne]=x',
      '?cursor[$gt]=',
      '?cursor=abc',
      '?limit=0',
      '?limit=101',
      '?action=panel.deleted',
    ]) {
      const res = await panelCall(h, token, 'GET', `${AUDIT}${query}`);
      expect(res.status, query).toBe(400);
    }
  });

  it('откат транзакции после append — записи нет', async () => {
    await memberUser(h, 'admin@example.by', 'admin');
    const audit = h.app.get(PanelAudit, { strict: false });
    const transactions = h.app.get(MongoTransactions, { strict: false });

    await expect(
      transactions.run(async (tx) => {
        await audit.append(tx, { action: 'panel.signed_in', actor: { kind: 'cli' } });
        throw new Error('действие откатилось');
      }),
    ).rejects.toThrow('действие откатилось');

    expect(await panel(h).audit.countDocuments()).toBe(0);
  });

  it('объект действия (admin-02): subject со снимком названия, changedFields, cancelReason; фильтр subjectId', async () => {
    const adminId = await memberUser(h, 'admin@example.by', 'admin');
    const token = await panelSession(h, 'admin@example.by');
    const audit = h.app.get(PanelAudit, { strict: false });
    const transactions = h.app.get(MongoTransactions, { strict: false });
    const raceId = '01890a5d-ac96-774b-bcce-b302099a8057';
    const seasonId = '01890a5d-ac96-774b-bcce-b302099a8058';
    const actor = { kind: 'user', userId: adminId } as const;

    await transactions.run(async (tx) => {
      await audit.append(tx, {
        action: 'season.updated',
        actor,
        subject: { kind: 'season', id: seasonId, label: 'Сезон 2026' },
        details: { changedFields: ['name'] },
      });
      await audit.append(tx, {
        action: 'race.cancelled',
        actor,
        subject: { kind: 'race', id: raceId, label: 'Минское кольцо' },
        details: { cancelReason: 'weather' },
      });
    });

    const { items } = await page(token, `?subjectId=${raceId}`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'race.cancelled',
      subject: { kind: 'race', id: raceId, label: 'Минское кольцо' },
      details: { cancelReason: 'weather' },
      target: null,
    });
    const all = await page(token);
    expect(all.items.find((entry) => entry.action === 'season.updated')).toMatchObject({
      subject: { kind: 'season', id: seasonId, label: 'Сезон 2026' },
      details: { changedFields: ['name'] },
    });
    // вход admin (admin-01) — без объекта
    expect(all.items.find((entry) => entry.action === 'panel.signed_in')?.subject).toBeNull();
    expect((await panelCall(h, token, 'GET', `${AUDIT}?subjectId=abc`)).status).toBe(400);
  });

  it('старые записи без поля subject (admin-01) читаются с subject: null', async () => {
    const adminId = await memberUser(h, 'admin@example.by', 'admin');
    await panel(h).audit.insertOne({
      _id: '01890a5d-ac96-774b-bcce-b302099a8000',
      at: h.clock.now(),
      action: 'panel.role_granted',
      actor: { kind: 'cli' },
      targetUserId: adminId,
      reason: null,
      details: { roleTo: 'admin' },
    });
    const token = await panelSession(h, 'admin@example.by');

    const { items } = await page(token);
    expect(items.map((entry) => [entry.action, entry.subject])).toEqual([
      ['panel.signed_in', null],
      ['panel.role_granted', null],
    ]);
  });

  it('PanelDirectory: имена сотрудников по id (без e-mail); нет члена команды — «Удалённый участник»', async () => {
    const adminId = await memberUser(h, 'admin@example.by', 'admin');
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8099';
    const names = await h.app
      .get(PanelDirectory, { strict: false })
      .displayNames([adminId, unknown, adminId]);
    expect([...names.entries()]).toEqual([
      [adminId, 'Сотрудник admin'],
      [unknown, 'Удалённый участник'],
    ]);
  });
});
