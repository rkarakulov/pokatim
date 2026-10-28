import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, StoryCardQuery, type StoryCardStatus, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { StoryCardService } from './story-card.service';

const raceIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** Статус карточки для сторис своего результата (story-cards): только вошедшие, `no-store`, пользователь — из access. */
@Controller('races')
@UseGuards(AuthGuard)
export class StoryCardController {
  constructor(private readonly cards: StoryCardService) {}

  @Get(':raceId/entry/story-card')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
    @Query(new ZodValidationPipe(StoryCardQuery, FieldErrorCode)) query: StoryCardQuery,
  ): Promise<StoryCardStatus> {
    return this.cards.status(user.userId, raceId, query.template);
  }
}
