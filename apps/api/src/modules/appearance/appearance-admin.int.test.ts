import { PanelAppearance } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panel, panelCookie } from '../../../test/panel';
import { fieldCodes, staff } from '../../../test/races';
import { appearanceCollections } from './appearance.collection';

/**
 * Тема приложения в панели (app-themes D1, AC2–AC4): только `appearance.manage` (admin); смена — по ожидаемой
 * `version`, каждая фактическая смена — одна запись журнала; повтор той же темы и конфликт — без записи.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const APPEARANCE = '/v1/admin/appearance';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const read = (token: string | undefined) =>
  call(h, 'GET', APPEARANCE, undefined, token ? panelCookie(token) : {});
const write = (token: string | undefined, body: unknown) =>
  call(h, 'PUT', APPEARANCE, body, token ? panelCookie(token) : {});

const settings = () => appearanceCollections(h.db).settings;
const themeAudit = () =>
  panel(h).audit.find({ action: 'appearance.theme_changed' }).sort({ _id: 1 }).toArray();

describe('права на тему приложения (AC2, AC3)', () => {
  it('moderator и organizer — 403 на GET и PUT; без сессии — 401', async () => {
    for (const role of ['moderator', 'organizer'] as const) {
      const member = await staff(h, `${role}@example.by`, role);
      expect((await read(member.token)).status, role).toBe(403);
      expect((await write(member.token, { themeId: 'atlas', version: 0 })).status, role).toBe(403);
    }
    expect((await read(undefined)).status).toBe(401);
    expect((await write(undefined, { themeId: 'atlas', version: 0 })).status).toBe(401);
    expect(await settings().countDocuments()).toBe(0);
  });
});

describe('чтение настройки (AC2)', () => {
  it('без документа — classic, версия 0, updatedAt null; no-store', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const res = await read(admin.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(PanelAppearance.parse(res.body)).toEqual({
      themeId: 'classic',
      version: 0,
      updatedAt: null,
    });
  });
});

describe('смена темы (AC3)', () => {
  it('верная версия — 200, version + 1, одна запись журнала; затем чтение отдаёт новую тему', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const first = await write(admin.token, { themeId: 'atlas', version: 0 });
    expect(first.status).toBe(200);
    const now = h.clock.now().toISOString();
    expect(PanelAppearance.parse(first.body)).toEqual({
      themeId: 'atlas',
      version: 1,
      updatedAt: now,
    });

    const second = await write(admin.token, { themeId: 'chrono', version: 1 });
    expect(PanelAppearance.parse(second.body)).toMatchObject({ themeId: 'chrono', version: 2 });
    expect(PanelAppearance.parse((await read(admin.token)).body)).toMatchObject({
      themeId: 'chrono',
      version: 2,
    });
    expect(await settings().find().toArray()).toEqual([
      { _id: 'appearance', themeId: 'chrono', version: 2, updatedAt: h.clock.now() },
    ]);

    const audit = await themeAudit();
    expect(
      audit.map((entry) => ({
        actor: entry.actor,
        subject: entry.subject,
        details: entry.details,
        reason: entry.reason,
        targetUserId: entry.targetUserId,
      })),
    ).toEqual([
      {
        actor: { kind: 'user', userId: admin.userId },
        subject: { kind: 'platform', id: NIL_UUID, label: 'Оформление приложения' },
        details: { themeFrom: 'classic', themeTo: 'atlas' },
        reason: null,
        targetUserId: null,
      },
      {
        actor: { kind: 'user', userId: admin.userId },
        subject: { kind: 'platform', id: NIL_UUID, label: 'Оформление приложения' },
        details: { themeFrom: 'atlas', themeTo: 'chrono' },
        reason: null,
        targetUserId: null,
      },
    ]);
  });

  it('устаревшая версия — 409 CONFLICT, документ и журнал без изменений', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    expect((await write(admin.token, { themeId: 'atlas', version: 0 })).status).toBe(200);

    const stale = await write(admin.token, { themeId: 'journal', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    const ahead = await write(admin.token, { themeId: 'journal', version: 5 });
    expect(ahead.status).toBe(409);

    expect(await settings().findOne({ _id: 'appearance' })).toMatchObject({
      themeId: 'atlas',
      version: 1,
    });
    expect(await themeAudit()).toHaveLength(1);
  });

  it('без документа версия ≠ 0 — 409 без записи', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    expect((await write(admin.token, { themeId: 'atlas', version: 1 })).status).toBe(409);
    expect(await settings().countDocuments()).toBe(0);
    expect(await themeAudit()).toHaveLength(0);
  });

  it('неизвестная тема, лишний ключ, плохая версия, операторы — 400 без записи', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const unknown = await write(admin.token, { themeId: 'neon', version: 0 });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldCodes(unknown.body)).toEqual(['themeId:INVALID']);

    for (const body of [
      { themeId: 'atlas', version: 0, updatedAt: '2026-10-27T10:00:00.000Z' },
      { themeId: 'atlas', version: -1 },
      { themeId: 'atlas', version: 1.5 },
      { themeId: 'atlas', version: { $ne: null } },
      { themeId: { $ne: null }, version: 0 },
      { themeId: 'atlas' },
    ]) {
      expect((await write(admin.token, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await settings().countDocuments()).toBe(0);
    expect(await themeAudit()).toHaveLength(0);
  });

  it('та же тема с верной версией — 200 без записи и журнала', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const same = await write(admin.token, { themeId: 'classic', version: 0 });
    expect(same.status).toBe(200);
    expect(PanelAppearance.parse(same.body)).toEqual({
      themeId: 'classic',
      version: 0,
      updatedAt: null,
    });
    expect(await settings().countDocuments()).toBe(0);

    await write(admin.token, { themeId: 'atlas', version: 0 });
    const repeat = await write(admin.token, { themeId: 'atlas', version: 1 });
    expect(PanelAppearance.parse(repeat.body)).toMatchObject({ themeId: 'atlas', version: 1 });
    expect(await themeAudit()).toHaveLength(1);
  });
});

describe('параллельные смены (AC4)', () => {
  it('две PUT с version 0 — одна 200, вторая 409; одна запись журнала', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const results = await Promise.all([
      write(admin.token, { themeId: 'atlas', version: 0 }),
      write(admin.token, { themeId: 'planner', version: 0 }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await settings().countDocuments()).toBe(1);
    expect(await themeAudit()).toHaveLength(1);

    const winner = PanelAppearance.parse(results.find((res) => res.status === 200)?.body);
    const updates = await Promise.all([
      write(admin.token, { themeId: 'journal', version: 1 }),
      write(admin.token, { themeId: 'navigation', version: 1 }),
    ]);
    expect(updates.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await themeAudit()).toHaveLength(2);
    expect(winner.version).toBe(1);
  });
});
