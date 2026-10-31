import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  type AchievementList,
  FieldErrorCode,
  MarkAchievementsSeenRequest,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { AchievementsService } from './achievements.service';

/** Свои достижения (ADR-0020): только вошедший, только свои (`@CurrentUser()`), `no-store`. */
@Controller('achievements')
@UseGuards(AuthGuard)
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<AchievementList> {
    return this.achievements.sync(user.userId);
  }

  @Post('seen')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async seen(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MarkAchievementsSeenRequest, FieldErrorCode))
    body: MarkAchievementsSeenRequest,
  ): Promise<void> {
    await this.achievements.markSeen(user.userId, body);
  }
}
