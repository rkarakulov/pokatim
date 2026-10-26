import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { FieldErrorCode, type RaceResultsPage, RaceResultsQuery, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { ResultsReadService } from './results-read.service';

/**
 * Публичная предварительная таблица гонки (race-results-03): без входа, имя райдера — только с
 * его согласием (profile-rider-name), иначе `riderName: null`; места при чтении,
 * `Cache-Control: public, max-age=60`, IP-лимит `public-read`. Черновик и неизвестная гонка — 404.
 */
@Controller('races')
@UseGuards(PublicReadGuard)
export class ResultsPublicController {
  constructor(private readonly read: ResultsReadService) {}

  @Get(':raceId/results')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  results(
    @Param('raceId', new ZodValidationPipe(Uuid, FieldErrorCode)) raceId: string,
    @Query(new ZodValidationPipe(RaceResultsQuery, FieldErrorCode)) query: RaceResultsQuery,
  ): Promise<RaceResultsPage> {
    return this.read.publicResults(raceId, query);
  }
}
