import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  UpdateVerifiedProfileRequest,
  type VerifiedProfileView,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { VerifiedProfileService } from './verified-profile.service';

/** Анкета зачёта Verified (race-results-07) — только своя: пользователь из access, `no-store`. */
@Controller('profile/verified')
@UseGuards(AuthGuard)
export class VerifiedProfileController {
  constructor(private readonly profiles: VerifiedProfileService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  view(@CurrentUser() user: AuthUser): Promise<VerifiedProfileView> {
    return this.profiles.view(user.userId);
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateVerifiedProfileRequest, FieldErrorCode))
    body: UpdateVerifiedProfileRequest,
  ): Promise<VerifiedProfileView> {
    return this.profiles.update(user.userId, body);
  }
}
