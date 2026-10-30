import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, StoryCardQuery, type StoryCardStatus, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RouteCardService } from './route-card.service';

const routeIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Статус карточки маршрута каталога для сторис (ADR-0018, route-story-card): только вошедшие (лимиты — по `uid`),
 * `no-store`, пользователь — из access. Картинка одна для всех зрителей с той же темой — только публичные поля
 * каталога.
 */
@Controller('routes')
@UseGuards(AuthGuard)
export class RouteCardController {
  constructor(private readonly cards: RouteCardService) {}

  @Get(':routeId/story-card')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentUser() user: AuthUser,
    @Param('routeId', routeIdPipe) routeId: string,
    @Query(new ZodValidationPipe(StoryCardQuery, FieldErrorCode)) query: StoryCardQuery,
  ): Promise<StoryCardStatus> {
    return this.cards.status(user.userId, routeId, query.template);
  }
}
