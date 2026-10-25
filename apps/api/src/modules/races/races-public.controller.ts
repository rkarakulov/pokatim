import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  type CurrentSeasonResponse,
  FieldErrorCode,
  type RaceDetail,
  RaceListQuery,
  type RacePage,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { RacesPublicService } from './races-public.service';

/**
 * Публичное чтение гонок и сезона (Q14, §13): без входа, только опубликованное и отменённое, `Cache-Control: public,
 * max-age=60`, IP-лимит `public-read`. Мутаций здесь нет.
 */
@Controller()
@UseGuards(PublicReadGuard)
export class RacesPublicController {
  constructor(private readonly races: RacesPublicService) {}

  @Get('races')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  list(
    @Query(new ZodValidationPipe(RaceListQuery, FieldErrorCode)) query: RaceListQuery,
  ): Promise<RacePage> {
    return this.races.list(query);
  }

  @Get('races/:id')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(@Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string): Promise<RaceDetail> {
    return this.races.get(id);
  }

  @Get('seasons/current')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  currentSeason(): Promise<CurrentSeasonResponse> {
    return this.races.currentSeason();
  }
}
