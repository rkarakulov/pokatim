import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, RiderHistoryQuery, type RiderRideHistoryPage } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RidesHistoryService } from './rides-history.service';

/** «Райды» своего профиля (rider-profile): только вошедший; путь под `/profile` — в модуле `rides`. */
@Controller('profile/rides')
@UseGuards(AuthGuard)
export class ProfileRidesController {
  constructor(private readonly history: RidesHistoryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RiderHistoryQuery, FieldErrorCode)) query: RiderHistoryQuery,
  ): Promise<RiderRideHistoryPage> {
    return this.history.list(user.userId, query);
  }
}
