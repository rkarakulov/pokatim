import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  AchievementCode,
  AchievementStoryCardQuery,
  FieldErrorCode,
  type StoryCardStatus,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { AchievementCardService } from './achievement-card.service';

const codePipe = new ZodValidationPipe(AchievementCode, FieldErrorCode);

/**
 * Статус карточки своего достижения (ADR-0018): только вошедшие, пользователь — из access (в пути код, в query —
 * сезон сезонного: выдача ищется по `(userId, code, seasonId)`, чужое недостижимо), `no-store`.
 */
@Controller('achievements')
@UseGuards(AuthGuard)
export class AchievementCardController {
  constructor(private readonly cards: AchievementCardService) {}

  @Get(':code/story-card')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentUser() user: AuthUser,
    @Param('code', codePipe) code: AchievementCode,
    @Query(new ZodValidationPipe(AchievementStoryCardQuery, FieldErrorCode))
    query: AchievementStoryCardQuery,
  ): Promise<StoryCardStatus> {
    return this.cards.status(user.userId, code, query);
  }
}
