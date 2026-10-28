import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, RiderHistoryQuery, type RiderRaceHistoryPage } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { ResultsHistoryService } from './results-history.service';

/** «Гонки» своего профиля (rider-profile): только вошедший, свои заявки; путь под `/profile` — в модуле `results`. */
@Controller('profile/races')
@UseGuards(AuthGuard)
export class ProfileRacesController {
  constructor(private readonly history: ResultsHistoryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RiderHistoryQuery, FieldErrorCode)) query: RiderHistoryQuery,
  ): Promise<RiderRaceHistoryPage> {
    return this.history.list(user.userId, query);
  }
}
