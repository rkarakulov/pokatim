import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type MySeasonStandings, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { StandingsReadService } from './standings-read.service';

/** Свои строки в таблицах сезона (race-results-08): только вошедший, пользователь — из access, `no-store`. */
@Controller('seasons/:id/standings')
@UseGuards(AuthGuard)
export class StandingsMeController {
  constructor(private readonly read: StandingsReadService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  mine(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) seasonId: string,
  ): Promise<MySeasonStandings> {
    return this.read.mine(seasonId, user.userId);
  }
}
