import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type RideDetail, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { RidesFeedService } from './rides-feed.service';

/**
 * Публичная карточка райда по ссылке (приглашение): без входа и без зрителя, кэш 60 с, IP-лимит `public-read`.
 * Опубликованный, отменённый и прошедший райд; без организатора, участников и `version`.
 */
@Controller('rides')
@UseGuards(PublicReadGuard)
export class RidesPublicController {
  constructor(private readonly feed: RidesFeedService) {}

  @Get(':id')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(@Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string): Promise<RideDetail> {
    return this.feed.get(id);
  }
}
