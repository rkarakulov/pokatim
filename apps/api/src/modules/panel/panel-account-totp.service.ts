import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  TotpDisableRequest,
  TotpRecoveryCodes,
  TotpSetup,
  TotpStatus,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import type { PanelPrincipal } from './current-panel-user.decorator';
import { PanelAudit } from './panel-audit';
import type { PanelTotpDoc } from './panel.collection';
import { PanelRepository } from './panel.repository';
import { invalidTotpCode, PanelTotpCodes } from './panel-totp-codes';

const notEnabled = () => domainError('TOTP_NOT_ENABLED', 409);

/**
 * 2FA своего аккаунта в настройках панели (ADR-0024, D9): статус, подключение (setup → confirm), перевыпуск кодов
 * восстановления и отключение. Любая роль, сотрудник — только из `PanelGuard`. Каждая попытка ввода кода — лимиты D8.
 */
@Injectable()
export class PanelAccountTotpService {
  private readonly logger = new Logger('PanelTotp');

  constructor(
    private readonly repository: PanelRepository,
    private readonly totp: PanelTotpCodes,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async status(principal: PanelPrincipal): Promise<TotpStatus> {
    const doc = await this.repository.findTotp(principal.userId);
    const active = doc?.status === 'active' ? doc : undefined;
    return {
      enabled: active !== undefined,
      enabledAt: active?.enabledAt?.toISOString() ?? null,
      required: this.totp.required(principal.role),
      recoveryCodesLeft: active?.recoveryCodes.filter((code) => code.usedAt === null).length ?? 0,
    };
  }

  /** Новый `pending` секрет (заменяет незавершённый); подключённая 2FA — `409 TOTP_ALREADY_ENABLED`. */
  async setup(principal: PanelPrincipal): Promise<TotpSetup> {
    const current = await this.repository.findTotp(principal.userId);
    if (current?.status === 'active') throw domainError('TOTP_ALREADY_ENABLED', 409);
    const next = await this.totp.newSecret(principal.userId);
    const started = await this.repository.startTotpSetup(
      principal.userId,
      next.secretEnc,
      next.epoch,
      this.clock.now(),
    );
    if (!started) throw domainError('TOTP_ALREADY_ENABLED', 409);
    return next.setup;
  }

  /** Первый код нового секрета → 2FA активна (`panel.totp_enabled`) и коды восстановления (один раз). */
  async confirm(principal: PanelPrincipal, code: string, ip: string): Promise<TotpRecoveryCodes> {
    const userId = principal.userId;
    const pending = await this.repository.findTotp(userId);
    if (pending?.status === 'active') throw domainError('TOTP_ALREADY_ENABLED', 409);
    if (!pending) throw notEnabled();
    this.totp.ensureAvailable();
    const now = this.clock.now();
    await this.totp.takeAttempt(userId, ip, now);
    const step = this.totp.matchTotp(pending, code, now);
    if (step === null) throw this.rejected(userId, 'подтверждение');
    const recovery = this.totp.newRecoveryCodes();
    await this.transactions.run(async (tx) => {
      // замок сотрудника: вход без фактора (`PanelSessionService.openWithoutFactor`) не проскочит мимо активации
      await this.repository.lockMember(tx, userId);
      const activated = await this.repository.activateTotp(tx, userId, {
        secretEnc: pending.secretEnc,
        step,
        recoveryHashes: recovery.hashes,
        now,
      });
      if (!activated) throw invalidTotpCode();
      await this.audit.append(tx, {
        action: 'panel.totp_enabled',
        actor: { kind: 'user', userId },
      });
    });
    return { recoveryCodes: recovery.codes };
  }

  /** Перевыпуск кодов восстановления — с текущим кодом TOTP; прежние коды гаснут. */
  async regenerateRecoveryCodes(
    principal: PanelPrincipal,
    code: string,
    ip: string,
  ): Promise<TotpRecoveryCodes> {
    const userId = principal.userId;
    const active = await this.activeTotp(userId, ip);
    const now = this.clock.now();
    const step = this.totp.matchTotp(active, code, now);
    if (step === null) throw this.rejected(userId, 'перевыпуск');
    const recovery = this.totp.newRecoveryCodes();
    await this.transactions.run(async (tx) => {
      const accepted = await this.repository.acceptTotpStep(tx, userId, {
        epoch: active.epoch,
        step,
        now,
      });
      if (!accepted) throw invalidTotpCode();
      await this.repository.replaceRecoveryCodes(tx, userId, recovery.hashes, now);
      await this.audit.append(tx, {
        action: 'panel.totp_recovery_regenerated',
        actor: { kind: 'user', userId },
      });
    });
    return { recoveryCodes: recovery.codes };
  }

  /**
   * Отключение — с кодом TOTP или восстановления: 2FA и доверенные устройства удаляются (`panel.totp_disabled`),
   * свои сессии остаются. admin при обязательности — `409 TOTP_REQUIRED` (до попытки кода).
   */
  async disable(principal: PanelPrincipal, input: TotpDisableRequest, ip: string): Promise<void> {
    const userId = principal.userId;
    if (this.totp.required(principal.role)) throw domainError('TOTP_REQUIRED', 409);
    const active = await this.activeTotp(userId, ip);
    const now = this.clock.now();
    let step: number | null = null;
    if ('code' in input) {
      step = this.totp.matchTotp(active, input.code, now);
      if (step === null) throw this.rejected(userId, 'отключение');
    }
    const recoveryHash = 'recoveryCode' in input ? this.totp.recoveryHash(input.recoveryCode) : '';
    await this.transactions.run(async (tx) => {
      const accepted =
        step !== null
          ? await this.repository.acceptTotpStep(tx, userId, { epoch: active.epoch, step, now })
          : await this.repository.useRecoveryCode(tx, userId, {
              epoch: active.epoch,
              hash: recoveryHash,
              now,
            });
      if (!accepted) throw invalidTotpCode();
      await this.repository.deleteTotp(tx, userId, 'active');
      await this.repository.deleteTrustedDevices(tx, userId);
      await this.audit.append(tx, {
        action: 'panel.totp_disabled',
        actor: { kind: 'user', userId },
      });
    });
    this.logger.log(`2FA панели отключена uid=${userId}`);
  }

  /** Подключённая 2FA (иначе 409), ключ на месте (иначе 503), попытка ввода кода списана (иначе 429). */
  private async activeTotp(userId: string, ip: string): Promise<PanelTotpDoc> {
    const doc = await this.repository.findTotp(userId);
    if (doc?.status !== 'active') throw notEnabled();
    this.totp.ensureAvailable();
    await this.totp.takeAttempt(userId, ip, this.clock.now());
    return doc;
  }

  private rejected(userId: string, what: string) {
    this.logger.log(`2FA панели: отказ (${what}) uid=${userId}`);
    return invalidTotpCode();
  }
}
