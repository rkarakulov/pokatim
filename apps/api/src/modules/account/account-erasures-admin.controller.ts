import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  type AccountErasurePage,
  AccountErasureQuery,
  FieldErrorCode,
  RetryAccountErasureRequest,
  type RetryAccountErasureResult,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { AccountErasuresAdminService } from './account-erasures-admin.service';

/**
 * «Сбои удаления аккаунтов» панели (erasure-failures, `platform.stats` — только admin): зависшие удаления и повтор
 * очистки с причиной. `no-store` ставит `PanelGuard`.
 */
@Controller('admin/account-erasures')
@UseGuards(PanelGuard)
@RequirePermission('platform.stats')
export class AccountErasuresAdminController {
  constructor(private readonly erasures: AccountErasuresAdminService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(AccountErasureQuery, FieldErrorCode)) query: AccountErasureQuery,
  ): Promise<AccountErasurePage> {
    return this.erasures.list(query);
  }

  @Post(':userId/retry')
  @HttpCode(200)
  retry(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('userId', new ZodValidationPipe(Uuid, FieldErrorCode)) userId: string,
    @Body(new ZodValidationPipe(RetryAccountErasureRequest, FieldErrorCode))
    body: RetryAccountErasureRequest,
  ): Promise<RetryAccountErasureResult> {
    return this.erasures.retry(actor.userId, userId, body);
  }
}
