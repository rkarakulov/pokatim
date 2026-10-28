import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, StoryCardQuery, type StoryCardStatus, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RideInviteService } from './ride-invite.service';

const rideIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Статус карточки-приглашения кофе-райда (ADR-0018): только вошедшие (лимиты — по `uid`), `no-store`, пользователь — из
 * access. Картинка одна для всех зрителей — только публичные поля райда.
 */
@Controller('rides')
@UseGuards(AuthGuard)
export class RideInviteController {
  constructor(private readonly invites: RideInviteService) {}

  @Get(':rideId/invite-card')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentUser() user: AuthUser,
    @Param('rideId', rideIdPipe) rideId: string,
    @Query(new ZodValidationPipe(StoryCardQuery, FieldErrorCode)) query: StoryCardQuery,
  ): Promise<StoryCardStatus> {
    return this.invites.status(user.userId, rideId, query.template);
  }
}
