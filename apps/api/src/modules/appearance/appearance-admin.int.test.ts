import { AuditPage, PanelAppearance } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panel, panelCookie } from '../../../test/panel';
import { fieldCodes, staff } from '../../../test/races';
import { MongoTransactions } from '../../db';
import { PanelAudit } from '../panel';
import { appearanceCollections } from './appearance.collection';

/**
 * Оформление приложения в панели (app-themes D1, halloween-decor; user-theme — только декор): `appearance.manage`
 * (admin); смена — по ожидаемой `version`, каждая фактическая смена декора — одна запись журнала; повтор и конфликт —
 * без записи. Тема — личная (`PUT /v1/profile/theme`): `themeId` в теле — 400.
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
const SUBJECT = { kind: 'platform', id: NIL_UUID, label: 'Оформление приложения' } as const;

const read = (token: string | undefined) =>
  call(h, 'GET', APPEARANCE, undefined, token ? panelCookie(token) : {});
const write = (token: string | undefined, body: unknown) =>
  call(h, 'PUT', APPEARANCE, body, token ? panelCookie(token) : {});

const settings = () => appearanceCollections(h.db).settings;
const themeAudit = () =>
  panel(h).audit.find({ action: 'appearance.theme_changed' }).sort({ _id: 1 }).toArray();
const decorAudit = () =>
  panel(h).audit.find({ action: 'appearance.decor_changed' }).sort({ _id: 1 }).toArray();

describe('права на оформление приложения (AC2, AC3)', () => {
  it('moderator и organizer — 403 на GET и PUT; без сессии — 401', async () => {
    for (const role of ['moderator', 'organizer'] as const) {
      const member = await staff(h, `${role}@example.by`, role);
      expect((await read(member.token)).status, role).toBe(403);
      expect((await write(member.token, { decor: 'halloween', version: 0 })).status, role).toBe(
        403,
      );
    }
    expect((await read(undefined)).status).toBe(401);
    expect((await write(undefined, { decor: 'halloween', version: 0 })).status).toBe(401);
    expect(await settings().countDocuments()).toBe(0);
  });
});

describe('чтение настройки (AC2)', () => {
  it('без документа — без декора, версия 0, updatedAt null, без темы; no-store', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const res = await read(admin.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ decor: 'none', version: 0, updatedAt: null });
  });

  it('документ с legacy themeId — тема наружу не выходит', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await settings().insertOne({
      _id: 'appearance',
      themeId: 'chrono',
      decor: 'halloween',
      version: 4,
      updatedAt: h.clock.now(),
    });
    expect((await read(admin.token)).body).toEqual({
      decor: 'halloween',
      version: 4,
      updatedAt: h.clock.now().toISOString(),
    });
  });
});

describe('сезонный декор (halloween-decor AC1, AC2; user-theme AC5)', () => {
  it('включить и выключить — по версии, журнал decorFrom/decorTo; первая вставка — без themeId', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const on = await write(admin.token, { decor: 'halloween', version: 0 });
    expect(on.status).toBe(200);
    expect(PanelAppearance.parse(on.body)).toEqual({
      decor: 'halloween',
      version: 1,
      updatedAt: h.clock.now().toISOString(),
    });
    expect(await settings().find().toArray()).toEqual([
      { _id: 'appearance', decor: 'halloween', version: 1, updatedAt: h.clock.now() },
    ]);

    const off = await write(admin.token, { decor: 'none', version: 1 });
    expect(PanelAppearance.parse(off.body)).toMatchObject({ decor: 'none', version: 2 });
    expect(PanelAppearance.parse((await read(admin.token)).body)).toMatchObject({
      decor: 'none',
      version: 2,
    });

    const audit = await decorAudit();
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
        subject: SUBJECT,
        details: { decorFrom: 'none', decorTo: 'halloween' },
        reason: null,
        targetUserId: null,
      },
      {
        actor: { kind: 'user', userId: admin.userId },
        subject: SUBJECT,
        details: { decorFrom: 'halloween', decorTo: 'none' },
        reason: null,
        targetUserId: null,
      },
    ]);
    expect(await themeAudit()).toHaveLength(0);
  });

  it('документ с legacy themeId — смена декора тему не трогает и не журналирует', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await settings().insertOne({
      _id: 'appearance',
      themeId: 'chrono',
      version: 1,
      updatedAt: h.clock.now(),
    });
    expect((await write(admin.token, { decor: 'halloween', version: 1 })).status).toBe(200);
    expect(await settings().findOne({ _id: 'appearance' })).toMatchObject({
      themeId: 'chrono',
      decor: 'halloween',
      version: 2,
    });
    expect(await themeAudit()).toHaveLength(0);
    expect(await decorAudit()).toHaveLength(1);
  });

  it('тот же декор — 200 без записи и журнала', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const same = await write(admin.token, { decor: 'none', version: 0 });
    expect(same.status).toBe(200);
    expect(same.body).toEqual({ decor: 'none', version: 0, updatedAt: null });
    expect(await settings().countDocuments()).toBe(0);

    await write(admin.token, { decor: 'halloween', version: 0 });
    const repeat = await write(admin.token, { decor: 'halloween', version: 1 });
    expect(PanelAppearance.parse(repeat.body)).toMatchObject({ decor: 'halloween', version: 1 });
    expect(await decorAudit()).toHaveLength(1);
  });

  it('устаревшая версия и версия ≠ 0 без документа — 409 CONFLICT без записи', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    expect((await write(admin.token, { decor: 'halloween', version: 1 })).status).toBe(409);
    expect(await settings().countDocuments()).toBe(0);

    expect((await write(admin.token, { decor: 'halloween', version: 0 })).status).toBe(200);
    const stale = await write(admin.token, { decor: 'none', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
    expect((await write(admin.token, { decor: 'none', version: 5 })).status).toBe(409);
    expect(await settings().findOne({ _id: 'appearance' })).toMatchObject({
      decor: 'halloween',
      version: 1,
    });
    expect(await decorAudit()).toHaveLength(1);
  });

  it('themeId в теле (тема — личная), неизвестный декор, лишний ключ, плохая версия, операторы — 400 без записи', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const unknown = await write(admin.token, { decor: 'new-year', version: 0 });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fieldCodes(unknown.body)).toEqual(['decor:INVALID']);

    for (const body of [
      { themeId: 'atlas', version: 0 },
      { themeId: 'atlas', decor: 'halloween', version: 0 },
      { decor: 'halloween', version: 0, updatedAt: '2026-10-27T10:00:00.000Z' },
      { decor: 'halloween', version: -1 },
      { decor: 'halloween', version: 1.5 },
      { decor: 'halloween', version: { $ne: null } },
      { decor: { $ne: null }, version: 0 },
      { decor: 'halloween' },
      { version: 0 },
    ]) {
      expect((await write(admin.token, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await settings().countDocuments()).toBe(0);
    expect(await decorAudit()).toHaveLength(0);
  });
});

describe('параллельные смены (AC4)', () => {
  it('две PUT с version 0 — одна 200, вторая 409; одна запись журнала', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const results = await Promise.all([
      write(admin.token, { decor: 'halloween', version: 0 }),
      write(admin.token, { decor: 'halloween', version: 0 }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await settings().countDocuments()).toBe(1);
    expect(await decorAudit()).toHaveLength(1);
  });
});

describe('журнал: история смен темы (user-theme A6)', () => {
  it('старая запись appearance.theme_changed читается журналом панели', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await h.app.get(MongoTransactions, { strict: false }).run(async (tx) => {
      await h.app.get(PanelAudit, { strict: false }).append(tx, {
        action: 'appearance.theme_changed',
        actor: { kind: 'user', userId: admin.userId },
        subject: SUBJECT,
        details: { themeFrom: 'classic', themeTo: 'atlas' },
      });
    });
    const res = await call(
      h,
      'GET',
      '/v1/admin/audit?action=appearance.theme_changed',
      undefined,
      panelCookie(admin.token),
    );
    expect(res.status).toBe(200);
    expect(AuditPage.parse(res.body).items.map((entry) => entry.details)).toEqual([
      { themeFrom: 'classic', themeTo: 'atlas' },
    ]);
  });
});
