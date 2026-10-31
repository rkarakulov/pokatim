import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../test/harness';
import {
  activeLinkToken,
  confirm,
  outboxEvents,
  register,
  userIdByEmail,
} from '../../test/identity';
import { PANEL_ROLE_EMAIL_REQUESTED } from '../modules/panel/panel.events';
import { panelCollections } from '../modules/panel/panel.collection';
import { seedMember, seedTotp } from '../../test/panel';
import { runPanelCli } from './panel-cli';

/** CLI `grant-admin` на тестовой БД (AC1): тот же код, что `node dist/cli/panel.js`, с явным окружением. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const EMAIL = 'olga@example.by';

async function cli(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runPanelCli(
    argv,
    () => ({ MONGO_URL: h.env.MONGO_URL, EMAIL_TOKEN_SECRET: h.env.EMAIL_TOKEN_SECRET }),
    { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) },
  );
  return { code, stdout, stderr };
}

const panel = () => panelCollections(h.db);

describe('CLI grant-admin (AC1)', () => {
  it('подтверждённый пользователь — член admin, журнал role_granted от cli; вывод — id без e-mail', async () => {
    await register(h, { email: EMAIL });
    await confirm(h, await activeLinkToken(h, EMAIL));
    const userId = await userIdByEmail(h, EMAIL);

    const result = await cli('grant-admin', '--email', ' Olga@Example.by', '--name', 'Ольга');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(userId);
    expect(result.stdout + result.stderr).not.toContain('olga@');
    expect(await panel().members.findOne({ _id: userId })).toMatchObject({
      role: 'admin',
      status: 'active',
      displayName: 'Ольга',
      revokedAt: null,
    });
    const entries = await panel().audit.find().toArray();
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'panel.role_granted',
        actor: { kind: 'cli' },
        targetUserId: userId,
        reason: null,
        details: { roleTo: 'admin' },
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('olga@');
    // письмо о выдаче роли (ADR-0026): событие с id записи журнала, без e-mail
    const roleEmails = (await outboxEvents(h)).filter((e) => e.type === PANEL_ROLE_EMAIL_REQUESTED);
    expect(roleEmails.map((e) => e.payload)).toEqual([{ auditId: entries[0]?._id }]);
  });

  it('повтор для уже admin — код 0, «уже администратор», без новой записи', async () => {
    await register(h, { email: EMAIL });
    await confirm(h, await activeLinkToken(h, EMAIL));
    await cli('grant-admin', '--email', EMAIL, '--name', 'Ольга');

    const again = await cli('grant-admin', '--email', EMAIL, '--name', 'Другое имя');

    expect(again.code).toBe(0);
    expect(again.stdout).toContain('уже администратор');
    expect(await panel().audit.countDocuments()).toBe(1);
    // повтор без изменений — без второго письма
    expect(
      (await outboxEvents(h)).filter((e) => e.type === PANEL_ROLE_EMAIL_REQUESTED),
    ).toHaveLength(1);
    expect(await panel().members.findOne({})).toMatchObject({ displayName: 'Ольга' });
  });

  it('неизвестный и неподтверждённый адрес — код 2 без изменений и без e-mail в выводе', async () => {
    const unknown = await cli('grant-admin', '--email', EMAIL, '--name', 'Ольга');
    await register(h, { email: EMAIL });
    const unverified = await cli('grant-admin', '--email', EMAIL, '--name', 'Ольга');

    for (const result of [unknown, unverified]) {
      expect(result.code).toBe(2);
      expect(result.stdout + result.stderr).not.toContain('olga@');
    }
    expect(unverified.stderr).toContain('не подтверждён');
    expect(await panel().members.countDocuments()).toBe(0);
    expect(await panel().audit.countDocuments()).toBe(0);
  });

  it('снятый член и член с другой ролью — становится admin (аварийное восстановление)', async () => {
    await register(h, { email: EMAIL });
    await confirm(h, await activeLinkToken(h, EMAIL));
    const userId = await userIdByEmail(h, EMAIL);
    await panel().members.insertOne({
      _id: userId,
      role: 'moderator',
      status: 'active',
      displayName: 'Ольга',
      grantedAt: h.clock.now(),
      revokedAt: null,
      version: 0,
    });

    expect((await cli('grant-admin', '--email', EMAIL, '--name', 'Ольга')).code).toBe(0);

    expect(await panel().members.findOne({ _id: userId })).toMatchObject({ role: 'admin' });
    expect(await panel().audit.findOne({})).toMatchObject({
      details: { roleFrom: 'moderator', roleTo: 'admin' },
    });
  });

  it('снятый с прежней 2FA — admin без старой 2FA (ADR-0026, дополнение): подключит заново', async () => {
    await register(h, { email: EMAIL });
    await confirm(h, await activeLinkToken(h, EMAIL));
    const userId = await userIdByEmail(h, EMAIL);
    await seedMember(h, userId, 'moderator', { status: 'revoked' });
    await seedTotp(h, userId);

    expect((await cli('grant-admin', '--email', EMAIL, '--name', 'Ольга')).code).toBe(0);

    expect(await panel().members.findOne({ _id: userId })).toMatchObject({
      role: 'admin',
      status: 'active',
    });
    expect(await panel().totp.countDocuments({ _id: userId })).toBe(0);
  });

  it('аргументы: --help — 0; без команды, неизвестная команда, без --name, лишний флаг — 2', async () => {
    expect((await cli('--help')).code).toBe(0);
    expect((await cli()).code).toBe(2);
    expect((await cli('delete-admin')).code).toBe(2);
    expect((await cli('grant-admin', '--email', EMAIL)).code).toBe(2);
    expect((await cli('grant-admin', '--email', EMAIL, '--name', 'О', '--role', 'x')).code).toBe(2);
    expect((await cli('grant-admin', '--email', 'not-an-email', '--name', 'О')).code).toBe(2);
  });
});

describe('CLI reset-totp (ADR-0024, D10)', () => {
  it('сбрасывает 2FA: документ, устройства, сессии (totp_reset), журнал от cli; вывод — id без e-mail', async () => {
    await register(h, { email: EMAIL });
    await confirm(h, await activeLinkToken(h, EMAIL));
    const userId = await userIdByEmail(h, EMAIL);
    await seedMember(h, userId, 'admin');
    await seedTotp(h, userId);
    await panel().sessions.insertOne({
      _id: 'session-1',
      userId,
      tokenHash: 'hash',
      credentialsStamp: 'stamp',
      createdAt: h.clock.now(),
      lastSeenAt: h.clock.now(),
      idleExpiresAt: h.clock.now(),
      expiresAt: h.clock.now(),
      revokedAt: null,
      revokedReason: null,
    });

    const result = await cli('reset-totp', '--email', EMAIL);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(userId);
    expect(result.stdout + result.stderr).not.toContain('olga@');
    expect(await panel().totp.countDocuments()).toBe(0);
    expect(await panel().sessions.findOne({ _id: 'session-1' })).toMatchObject({
      revokedReason: 'totp_reset',
    });
    expect(await panel().audit.find().toArray()).toEqual([
      expect.objectContaining({
        action: 'panel.totp_reset',
        actor: { kind: 'cli' },
        targetUserId: userId,
      }),
    ]);

    const again = await cli('reset-totp', '--email', EMAIL);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('не подключена');
    expect(await panel().audit.countDocuments()).toBe(1);
  });

  it('неизвестный адрес — код 2; без --email или с --name — код 2', async () => {
    expect((await cli('reset-totp', '--email', EMAIL)).code).toBe(2);
    expect((await cli('reset-totp')).code).toBe(2);
    expect((await cli('reset-totp', '--email', EMAIL, '--name', 'X')).code).toBe(2);
  });
});
