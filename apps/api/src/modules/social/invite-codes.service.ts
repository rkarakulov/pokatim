import { Inject, Injectable, Optional } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { INVITE_CODES_CODE_UNIQUE_INDEX, InviteCodesRepository } from './invite-codes.repository';
import { generateInviteCode } from './social.policy';

/** Генератор кода — внедряемый для теста коллизии; по умолчанию `generateInviteCode`. */
export const INVITE_CODE_GENERATOR = Symbol('INVITE_CODE_GENERATOR');
export type InviteCodeGenerator = () => string;

const MAX_ATTEMPTS = 5;

/**
 * Личные коды приглашений (K9, P6): выдача лениво (`_id` = userId — один код на райдера) и разрешение кода во
 * владельца. Порт для `sharing` (адрес на карточке) и intake приглашений.
 */
@Injectable()
export class InviteCodes {
  private readonly generate: InviteCodeGenerator;

  constructor(
    private readonly repository: InviteCodesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(INVITE_CODE_GENERATOR) generate?: InviteCodeGenerator,
  ) {
    this.generate = generate ?? generateInviteCode;
  }

  /**
   * Код райдера; нет — выдать. Параллельная первая выдача (дубль `_id`) — перечитать выданный; коллизия кода — новый.
   * Исчерпаны попытки — бросок (500).
   */
  async ensureOf(userId: string): Promise<string> {
    const existing = await this.repository.findCode(userId);
    if (existing) return existing;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const code = this.generate();
      try {
        await this.repository.insert(userId, code, this.clock.now());
        return code;
      } catch (error) {
        if (isDuplicateKey(error, INVITE_CODES_CODE_UNIQUE_INDEX)) continue;
        if (!isDuplicateKey(error, '_id_')) throw error;
        const raced = await this.repository.findCode(userId);
        if (raced) return raced;
        throw error;
      }
    }
    throw new Error('invite code: attempts exhausted');
  }

  /** Владелец кода; неизвестный — `undefined`. */
  ownerOf(code: string): Promise<string | undefined> {
    return this.repository.ownerOf(code);
  }
}
