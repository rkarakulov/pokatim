import { Body, Controller, HttpCode, Ip, Post, Res, UseGuards } from '@nestjs/common';
import { DeleteAccountRequest, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser, SessionCookie } from '../identity';
import { AccountDeletionService } from './account-deletion.service';

/**
 * Удаление своего аккаунта (`POST /v1/account/delete`) — только вошедшему; пользователь — из access, не из тела.
 * Ответ `204` без тела, не кешируется; web — cookie refresh сброшена (атрибуты — как при выдаче).
 */
@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly cookie: SessionCookie,
  ) {}

  @Post('delete')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DeleteAccountRequest, FieldErrorCode)) body: DeleteAccountRequest,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<void> {
    this.cookie.noStore(reply);
    await this.deletion.delete(user.userId, body, ip);
    this.cookie.clear(reply);
  }
}
