import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isDomainError } from '@rkarakulov/api-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IdentityAccounts } from '../identity';
import type { PanelRequest } from './current-panel-user.decorator';
import { PanelGuard } from './panel.guard';
import type { PanelMemberDoc, PanelSessionDoc } from './panel.collection';
import type { PanelRepository } from './panel.repository';
import { PanelSessionCheck } from './panel-session-check';
import type { PanelSessionCookie } from './panel-session-cookie';
import { PANEL_PUBLIC } from './public.decorator';
import { PANEL_PERMISSION } from './require-permission.decorator';

const NOW = new Date('2026-10-25T10:00:00.000Z');
const TOKEN = 't'.repeat(43);
const session = { _id: 'sid', userId: 'uid', credentialsStamp: 'stamp' } as PanelSessionDoc;
const member = { _id: 'uid', role: 'moderator', status: 'active' } as PanelMemberDoc;

/** Гард на заглушках: порядок проверок и отказы без БД (поведение на реальной БД — panel-session.int.test.ts). */
function setup(
  options: {
    token?: string;
    metadata?: Record<string, unknown>;
    session?: PanelSessionDoc;
    account?: { active: boolean; credentialsStamp: string };
    member?: PanelMemberDoc;
  } = {},
) {
  const repository = {
    findLiveSession: vi.fn().mockResolvedValue('session' in options ? options.session : session),
    findActiveMember: vi.fn().mockResolvedValue('member' in options ? options.member : member),
    revokeSession: vi.fn().mockResolvedValue(true),
    touchSession: vi.fn().mockResolvedValue(undefined),
  };
  const accounts = {
    accountState: vi
      .fn()
      .mockResolvedValue(options.account ?? { active: true, credentialsStamp: 'stamp' }),
  };
  const token = 'token' in options ? options.token : TOKEN;
  const cookie = {
    noStore: vi.fn(),
    clear: vi.fn(),
    read: vi.fn().mockReturnValue({ token, presented: token !== undefined }),
  };
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
    (key: unknown) => options.metadata?.[String(key)],
  );
  const guard = new PanelGuard(
    reflector,
    repository as unknown as PanelRepository,
    new PanelSessionCheck(
      accounts as unknown as IdentityAccounts,
      repository as unknown as PanelRepository,
    ),
    cookie as unknown as PanelSessionCookie,
    { now: () => NOW },
  );
  const request: PanelRequest = {};
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { guard, context, request, repository, accounts, cookie };
}

async function outcome(run: Promise<boolean>) {
  try {
    return await run;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { code: error.code, status: error.status };
  }
}

const unauthorized = { code: 'UNAUTHORIZED', status: 401 };

describe('PanelGuard — порядок отказов', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('публичный маршрут — только no-store, без чтения cookie и БД', async () => {
    const { guard, context, cookie, repository } = setup({ metadata: { [PANEL_PUBLIC]: true } });
    expect(await guard.canActivate(context)).toBe(true);
    expect(cookie.noStore).toHaveBeenCalled();
    expect(cookie.read).not.toHaveBeenCalled();
    expect(repository.findLiveSession).not.toHaveBeenCalled();
  });

  it('нет cookie — 401 до БД, сбрасывать нечего', async () => {
    const { guard, context, repository, cookie } = setup({ token: undefined });
    expect(await outcome(guard.canActivate(context))).toEqual(unauthorized);
    expect(repository.findLiveSession).not.toHaveBeenCalled();
    expect(cookie.clear).not.toHaveBeenCalled();
  });

  it('нет живой сессии — 401 и сброс cookie, аккаунт не читается', async () => {
    const { guard, context, accounts, cookie } = setup({ session: undefined });
    expect(await outcome(guard.canActivate(context))).toEqual(unauthorized);
    expect(accounts.accountState).not.toHaveBeenCalled();
    expect(cookie.clear).toHaveBeenCalled();
  });

  it('аккаунт неактивен — account_inactive; штамп не совпал — credentials_changed; член не читается', async () => {
    for (const [account, reason] of [
      [{ active: false, credentialsStamp: 'stamp' }, 'account_inactive'],
      [{ active: true, credentialsStamp: 'other' }, 'credentials_changed'],
    ] as const) {
      const { guard, context, repository } = setup({ account });
      expect(await outcome(guard.canActivate(context))).toEqual(unauthorized);
      expect(repository.findActiveMember).not.toHaveBeenCalled();
      expect(repository.revokeSession).toHaveBeenCalledWith({ id: 'sid' }, NOW, reason);
    }
  });

  it('роль снята — role_revoked, 401', async () => {
    const { guard, context, repository } = setup({ member: undefined });
    expect(await outcome(guard.canActivate(context))).toEqual(unauthorized);
    expect(repository.revokeSession).toHaveBeenCalledWith({ id: 'sid' }, NOW, 'role_revoked');
  });

  it('нет права — 403 FORBIDDEN; есть — request.panel из сессии и роли, простой продлевается', async () => {
    const denied = setup({ metadata: { [PANEL_PERMISSION]: 'members.read' } });
    expect(await outcome(denied.guard.canActivate(denied.context))).toEqual({
      code: 'FORBIDDEN',
      status: 403,
    });

    const allowed = setup({ metadata: { [PANEL_PERMISSION]: 'audit.read' } });
    expect(await allowed.guard.canActivate(allowed.context)).toBe(true);
    expect(allowed.request.panel).toEqual({
      userId: 'uid',
      sessionId: 'sid',
      role: 'moderator',
      permissions: [
        'audit.read',
        'races.read',
        'rides.moderate',
        'disputes.read',
        'disputes.decide',
        'profiles.moderate',
      ],
    });
    expect(allowed.repository.touchSession).toHaveBeenCalled();
  });
});
