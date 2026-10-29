import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PanelMe,
  PanelRole,
  PanelSignInResponse,
  TotpSetup,
  TotpSetupConfirmRequest,
  TotpSignInRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { IdentityAccounts, PanelCredentials, randomToken, sha256 } from '../identity';
import type { PanelPrincipal } from './current-panel-user.decorator';
import { PanelAudit } from './panel-audit';
import type {
  PanelMemberDoc,
  PanelSecondFactor,
  PanelSignInChallengeDoc,
  PanelTotpDoc,
} from './panel.collection';
import { DELETED_MEMBER, PANEL_POLICY } from './panel.policy';
import { PanelRepository } from './panel.repository';
import { PanelSessionCheck } from './panel-session-check';
import { invalidTotpCode, PanelTotpCodes } from './panel-totp-codes';
import { permissionsOf } from './permissions';

/** Новая сессия: токен cookie панели и (при «запомнить устройство») токен cookie устройства. */
export interface OpenedSession {
  state: 'signedIn';
  me: PanelMe;
  token: string;
  expiresAt: Date;
  device: { token: string; expiresAt: Date } | null;
}

export type PanelSignInResult =
  | OpenedSession
  | Extract<PanelSignInResponse, { state: 'verificationRequired' }>
  | Extract<PanelSignInResponse, { state: 'totpRequired' | 'totpSetupRequired' }>;

const challengeExpired = () => domainError('TOTP_CHALLENGE_EXPIRED', 401);

/** Ожидаемый отказ внутри транзакции второго шага: вызов не гасится, неверная попытка списывается. */
class RejectedCode extends Error {}

/**
 * Сессия панели (ADR-0009, R1; 2FA — ADR-0024): вход паролем через порт identity, второй шаг (код TOTP, код
 * восстановления, доверенное устройство или подключение 2FA на входе), отдельная серверная сессия (токен в cookie,
 * в БД — sha256), выход. Проверка на каждом запросе — `PanelGuard`.
 */
@Injectable()
export class PanelSessionService {
  private readonly logger = new Logger('PanelSession');

  constructor(
    private readonly credentials: PanelCredentials,
    private readonly accounts: IdentityAccounts,
    private readonly repository: PanelRepository,
    private readonly check: PanelSessionCheck,
    private readonly audit: PanelAudit,
    private readonly totp: PanelTotpCodes,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Вход: пароль (лимиты и 401 — как у приложения) → `verificationRequired` как есть → член команды `active`, иначе
   * `403 PANEL_ACCESS_DENIED` (только после верного пароля) → 2FA (D2, D4, D7): активна — живое доверенное
   * устройство (штамп и эпоха совпали) даёт сессию, иначе вызов `totpRequired`; нет 2FA, admin и обязательность —
   * вызов `totpSetupRequired`; иначе — сессия сразу (+ `panel.signed_in` и отзыв прежней cookie одной транзакцией).
   */
  async signIn(
    input: { email: string; password: string },
    ip: string,
    previousToken: string | undefined,
    deviceToken: string | undefined,
  ): Promise<PanelSignInResult> {
    const verified = await this.credentials.verify(input, ip);
    if (verified.state === 'verificationRequired') return verified;

    const member = await this.repository.findActiveMember(verified.userId);
    if (!member) throw domainError('PANEL_ACCESS_DENIED', 403);
    const subject = { userId: verified.userId, credentialsStamp: verified.credentialsStamp };

    const totp = await this.repository.findTotp(verified.userId);
    if (totp?.status === 'active') {
      this.totp.ensureAvailable();
      if (await this.trustedDevice(deviceToken, subject, totp)) {
        return this.transactions.run((tx) =>
          this.openSession(tx, { ...subject, member, totp, secondFactor: 'device' }, previousToken),
        );
      }
      return this.issueChallenge(subject, 'totp');
    }
    if (this.totp.required(member.role)) {
      this.totp.ensureAvailable();
      return this.issueChallenge(subject, 'setup');
    }
    return this.transactions.run((tx) =>
      this.openSession(tx, { ...subject, member, totp, secondFactor: null }, previousToken),
    );
  }

  /**
   * Второй шаг: код TOTP или код восстановления по живому вызову. Попытка списывает лимиты D8; неверный, повторённый
   * или погашенный код — `400 TOTP_INVALID_CODE` (+1 попытка вызова, 5-я гасит вызов). Успех одной транзакцией:
   * гашение вызова, принятие шага / гашение кода восстановления (+ `panel.totp_recovery_used`), сессия, устройство.
   */
  async completeTotp(
    input: TotpSignInRequest,
    ip: string,
    previousToken: string | undefined,
  ): Promise<OpenedSession> {
    const { challenge, member } = await this.liveChallenge(input.challenge, 'totp', ip);
    const totp = await this.repository.findTotp(challenge.userId);
    if (totp?.status !== 'active') throw await this.expire(challenge);
    this.totp.ensureAvailable();
    const now = this.clock.now();

    let step: number | null = null;
    let recoveryHash: string | null = null;
    if ('code' in input) {
      step = this.totp.matchTotp(totp, input.code, now);
      if (step === null) throw await this.reject(challenge, 'код');
    } else {
      recoveryHash = this.totp.recoveryHash(input.recoveryCode);
    }
    const secondFactor: PanelSecondFactor = step === null ? 'recovery' : 'totp';

    return this.finishChallenge(challenge, 'код', async (tx) => {
      const accepted =
        step !== null
          ? await this.repository.acceptTotpStep(challenge.userId, step, now, tx)
          : await this.repository.useRecoveryCode(tx, challenge.userId, recoveryHash ?? '', now);
      if (!accepted) throw new RejectedCode();
      if (secondFactor === 'recovery') {
        await this.audit.append(tx, {
          action: 'panel.totp_recovery_used',
          actor: { kind: 'user', userId: challenge.userId },
        });
      }
      return this.openSession(
        tx,
        { ...challenge, member, totp, secondFactor },
        previousToken,
        input.rememberDevice,
      );
    });
  }

  /** Подключение 2FA на экране входа (`totpSetupRequired`): новый `pending` секрет, вызов не гасится. */
  async startSetup(challengeToken: string, ip: string): Promise<TotpSetup> {
    const { challenge } = await this.liveChallenge(challengeToken, 'setup', ip, false);
    const next = await this.totp.newSecret(challenge.userId);
    const started = await this.repository.startTotpSetup(
      challenge.userId,
      next.secretEnc,
      next.epoch,
      this.clock.now(),
    );
    if (!started) throw domainError('TOTP_ALREADY_ENABLED', 409);
    return next.setup;
  }

  /**
   * Подтверждение подключения на входе: первый код нового секрета → 2FA активна (`panel.totp_enabled`), коды
   * восстановления (один раз), сессия (+ устройство) — одной транзакцией с гашением вызова.
   */
  async confirmSetup(
    input: TotpSetupConfirmRequest,
    ip: string,
    previousToken: string | undefined,
  ): Promise<OpenedSession & { recoveryCodes: string[] }> {
    const { challenge, member } = await this.liveChallenge(input.challenge, 'setup', ip);
    const pending = await this.repository.findTotp(challenge.userId);
    if (pending?.status !== 'pending') throw await this.reject(challenge, 'подключение');
    const now = this.clock.now();
    const step = this.totp.matchTotp(pending, input.code, now);
    if (step === null) throw await this.reject(challenge, 'код подключения');
    const recovery = this.totp.newRecoveryCodes();

    const opened = await this.finishChallenge(challenge, 'код подключения', async (tx) => {
      const activated = await this.repository.activateTotp(tx, challenge.userId, {
        secretEnc: pending.secretEnc,
        step,
        recoveryHashes: recovery.hashes,
        now,
      });
      if (!activated) throw new RejectedCode();
      await this.audit.append(tx, {
        action: 'panel.totp_enabled',
        actor: { kind: 'user', userId: challenge.userId },
      });
      const totp: PanelTotpDoc = { ...pending, status: 'active' };
      return this.openSession(
        tx,
        { ...challenge, member, totp, secondFactor: 'totp' },
        previousToken,
        input.rememberDevice,
      );
    });
    return { ...opened, recoveryCodes: recovery.codes };
  }

  /** «Кто я»: роль и права — из гарда этого запроса, имя, e-mail и 2FA — одним чтением каждого. */
  async me(principal: PanelPrincipal): Promise<PanelMe> {
    const [member, emails, totp] = await Promise.all([
      this.repository.findActiveMember(principal.userId),
      this.accounts.emailsOf([principal.userId]),
      this.repository.findTotp(principal.userId),
    ]);
    if (!member) throw domainError('UNAUTHORIZED', 401);
    return {
      user: {
        id: principal.userId,
        displayName: member.displayName,
        email: emails.get(principal.userId) ?? DELETED_MEMBER,
        role: principal.role,
        totp: this.totpView(totp, principal.role),
      },
      permissions: [...principal.permissions],
    };
  }

  /**
   * Выход по cookie (идемпотентно): живая сессия отзывается вместе с записью `panel.signed_out` одной транзакцией;
   * мёртвая или чужая — ничего не меняется (ответ тот же).
   */
  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    const now = this.clock.now();
    const session = await this.repository.findLiveSession(sha256(token), now);
    if (!session) return;
    // сессия, которую гард уже не пропустил бы (сброс пароля, снятие роли, удаление), — отзыв с его причиной, без
    // записи о выходе: сотрудника в панели уже нет
    const verdict = await this.check.verdict(session);
    if (!verdict.valid) {
      await this.repository.revokeSession({ id: session._id }, now, verdict.reason);
      return;
    }
    await this.transactions.run(async (tx) => {
      const revoked = await this.repository.revokeSession(
        { id: session._id },
        now,
        'signed_out',
        tx,
      );
      if (!revoked) return;
      await this.audit.append(tx, {
        action: 'panel.signed_out',
        actor: { kind: 'user', userId: session.userId },
      });
    });
  }

  private totpView(totp: PanelTotpDoc | undefined, role: PanelRole) {
    return { enabled: totp?.status === 'active', required: this.totp.required(role) };
  }

  /** Живое доверенное устройство этого сотрудника: штамп учётных данных и эпоха 2FA — текущие (D4). */
  private async trustedDevice(
    deviceToken: string | undefined,
    subject: { userId: string; credentialsStamp: string },
    totp: PanelTotpDoc,
  ): Promise<boolean> {
    if (!deviceToken) return false;
    const device = await this.repository.findLiveTrustedDevice(
      sha256(deviceToken),
      subject.userId,
      this.clock.now(),
    );
    return (
      device !== undefined &&
      device.credentialsStamp === subject.credentialsStamp &&
      device.totpEpoch === totp.epoch
    );
  }

  private async issueChallenge(
    subject: { userId: string; credentialsStamp: string },
    purpose: 'totp' | 'setup',
  ): Promise<Extract<PanelSignInResult, { state: 'totpRequired' | 'totpSetupRequired' }>> {
    const now = this.clock.now();
    const token = randomToken();
    await this.repository.insertChallenge({
      _id: uuidv7(),
      tokenHash: sha256(token),
      userId: subject.userId,
      credentialsStamp: subject.credentialsStamp,
      purpose,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PANEL_POLICY.challengeTtlMs),
    });
    this.logger.log(`вход в панель: второй шаг uid=${subject.userId} purpose=${purpose}`);
    return {
      state: purpose === 'totp' ? 'totpRequired' : 'totpSetupRequired',
      challenge: token,
      expiresInSec: PANEL_POLICY.challengeTtlMs / 1000,
    };
  }

  /**
   * Живой вызов нужного назначения → (попытка ввода кода — лимиты D8) → аккаунт активен, штамп тот же, член
   * `active`. Иначе — `401 TOTP_CHALLENGE_EXPIRED` (вход заново с паролем); вызов со сменившимся штампом гасится.
   */
  private async liveChallenge(
    token: string,
    purpose: 'totp' | 'setup',
    ip: string,
    attempt = true,
  ): Promise<{ challenge: PanelSignInChallengeDoc; member: PanelMemberDoc }> {
    const now = this.clock.now();
    const challenge = await this.repository.findLiveChallenge(
      sha256(token),
      now,
      PANEL_POLICY.challengeMaxAttempts,
    );
    if (challenge?.purpose !== purpose) throw challengeExpired();
    if (attempt) await this.totp.takeAttempt(challenge.userId, ip, now);
    const account = await this.accounts.accountState(challenge.userId);
    const member = await this.repository.findActiveMember(challenge.userId);
    if (!account?.active || account.credentialsStamp !== challenge.credentialsStamp || !member) {
      throw await this.expire(challenge);
    }
    return { challenge, member };
  }

  /** Вызов больше не годен (штамп, роль, 2FA сменились) — гасится, ответ `401 TOTP_CHALLENGE_EXPIRED`. */
  private async expire(challenge: PanelSignInChallengeDoc) {
    await this.transactions.run((tx) => this.repository.consumeChallenge(tx, challenge._id));
    return challengeExpired();
  }

  /** Неверный код: попытка вызова списывается; лог — `uid` и причина, без кода. */
  private async reject(challenge: PanelSignInChallengeDoc, what: string) {
    await this.repository.failChallenge(challenge._id, PANEL_POLICY.challengeMaxAttempts);
    this.logger.log(`2FA панели: отказ (${what}) uid=${challenge.userId}`);
    return invalidTotpCode();
  }

  /** Транзакция второго шага: вызов гасится атомарно (уже погашен — 401); `RejectedCode` — неверный код (400). */
  private async finishChallenge<T>(
    challenge: PanelSignInChallengeDoc,
    what: string,
    work: (tx: DbSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.transactions.run(async (tx) => {
        if (!(await this.repository.consumeChallenge(tx, challenge._id))) throw challengeExpired();
        return work(tx);
      });
    } catch (error) {
      if (error instanceof RejectedCode) throw await this.reject(challenge, what);
      throw error;
    }
  }

  /**
   * Сессия + `panel.signed_in` + отзыв прежней cookie этого браузера (`superseded`) + доверенное устройство — в
   * транзакции вызывающего: сбой отзыва отменяет и вход.
   */
  private async openSession(
    tx: DbSession,
    input: {
      userId: string;
      credentialsStamp: string;
      member: PanelMemberDoc;
      totp: PanelTotpDoc | undefined;
      secondFactor: PanelSecondFactor | null;
    },
    previousToken: string | undefined,
    rememberDevice = false,
  ): Promise<OpenedSession> {
    const now = this.clock.now();
    const token = randomToken();
    const sessionId = uuidv7();
    const expiresAt = new Date(now.getTime() + PANEL_POLICY.sessionAbsoluteMs);
    await this.repository.insertSession(tx, {
      _id: sessionId,
      userId: input.userId,
      tokenHash: sha256(token),
      credentialsStamp: input.credentialsStamp,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + PANEL_POLICY.sessionIdleMs),
      expiresAt,
      secondFactor: input.secondFactor,
    });
    await this.audit.append(tx, {
      action: 'panel.signed_in',
      actor: { kind: 'user', userId: input.userId },
    });
    if (previousToken) {
      await this.repository.revokeSession(
        { tokenHash: sha256(previousToken) },
        now,
        'superseded',
        tx,
      );
    }
    let device: OpenedSession['device'] = null;
    if (rememberDevice && input.totp) {
      device = {
        token: randomToken(),
        expiresAt: new Date(now.getTime() + PANEL_POLICY.trustedDeviceTtlMs),
      };
      await this.repository.insertTrustedDevice(
        tx,
        {
          _id: uuidv7(),
          tokenHash: sha256(device.token),
          userId: input.userId,
          credentialsStamp: input.credentialsStamp,
          totpEpoch: input.totp.epoch,
          createdAt: now,
          expiresAt: device.expiresAt,
        },
        PANEL_POLICY.trustedDeviceMax,
      );
    }
    this.logger.log(
      `вход в панель uid=${input.userId} sid=${sessionId} factor=${input.secondFactor ?? 'none'}`,
    );
    const emails = await this.accounts.emailsOf([input.userId]);
    return {
      state: 'signedIn',
      me: {
        user: {
          id: input.userId,
          displayName: input.member.displayName,
          email: emails.get(input.userId) ?? DELETED_MEMBER,
          role: input.member.role,
          totp: this.totpView(input.totp, input.member.role),
        },
        permissions: permissionsOf(input.member.role),
      },
      token,
      expiresAt,
      device,
    };
  }
}
