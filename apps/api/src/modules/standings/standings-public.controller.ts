import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type SeasonStandingsSummary,
  type SeasonStandingsTable,
  SeasonStandingsTableQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { StandingsReadService } from './standings-read.service';

const seasonIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Публичный рейтинг сезона (race-results-08): без входа, `public, max-age=60`, IP-лимит `public-read`; без `userId`,
 * имя — только с согласием. Неизвестный сезон — 404. Сегменты после `standings` статические.
 */
@Controller('seasons/:id/standings')
@UseGuards(PublicReadGuard)
export class StandingsPublicController {
  constructor(private readonly read: StandingsReadService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  summary(@Param('id', seasonIdPipe) seasonId: string): Promise<SeasonStandingsSummary> {
    return this.read.summary(seasonId);
  }

  @Get('table')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  table(
    @Param('id', seasonIdPipe) seasonId: string,
    @Query(new ZodValidationPipe(SeasonStandingsTableQuery, FieldErrorCode))
    query: SeasonStandingsTableQuery,
  ): Promise<SeasonStandingsTable> {
    return this.read.table(seasonId, query);
  }
}
