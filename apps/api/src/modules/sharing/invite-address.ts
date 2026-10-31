import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { InviteCodes } from '../social';

/**
 * Короткая ссылка приглашения на карточке для сторис (P6, K9): `<host APP_WEB_ORIGIN>/i/<код владельца>`. Нет
 * `APP_WEB_ORIGIN` (dev) или сбой порта кодов — `null`, карточка без строки адреса (RC-P6-6). Считает только HTTP:
 * адрес уходит в данные задачи и хэш (RC-P6-5).
 */
@Injectable()
export class InviteAddress {
  private readonly logger = new Logger(InviteAddress.name);

  constructor(
    private readonly codes: InviteCodes,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_WEB_ORIGIN'>,
  ) {}

  async of(userId: string): Promise<string | null> {
    const origin = this.env.APP_WEB_ORIGIN;
    if (!origin) return null;
    try {
      return `${new URL(origin).host}/i/${await this.codes.ensureOf(userId)}`;
    } catch (error) {
      this.logger.warn(
        `sharing.invite_address_failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return null;
    }
  }
}
