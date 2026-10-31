import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { InviteCodeResponse } from '@pokatim/contracts';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { InviteCodes } from './invite-codes.service';

/** Личный код приглашения (K9, P6): только вошедший, свой; выдаётся при первом запросе (RC-P6-13), `no-store`. */
@Controller('social/invite-code')
@UseGuards(AuthGuard)
export class InviteCodeController {
  constructor(private readonly codes: InviteCodes) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@CurrentUser() user: AuthUser): Promise<InviteCodeResponse> {
    return { code: await this.codes.ensureOf(user.userId) };
  }
}
