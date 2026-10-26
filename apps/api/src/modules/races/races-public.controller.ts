import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  CatalogRouteRacesQuery,
  type CurrentSeasonResponse,
  FieldErrorCode,
  type RaceDetail,
  RaceListQuery,
  type RacePage,
  type RaceRouteMap,
  type SeasonCard,
  type SeasonList,
  SeasonRaceListQuery,
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

  /** Линия показа коридора для карты (ADR-0014): только опубликованная/отменённая с коридором и готовым маршрутом. */
  @Get('races/:id/route')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  route(
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string,
  ): Promise<RaceRouteMap> {
    return this.races.route(id);
  }

  @Get('seasons')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  seasons(): Promise<SeasonList> {
    return this.races.listSeasons();
  }

  /** Объявлен до `seasons/:id`: иначе `current` уйдёт в pipe `Uuid` и получит 400. */
  @Get('seasons/current')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  currentSeason(): Promise<CurrentSeasonResponse> {
    return this.races.currentSeason();
  }

  @Get('seasons/:id')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  season(
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string,
  ): Promise<SeasonCard> {
    return this.races.getSeason(id);
  }

  @Get('seasons/:id/races')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  seasonRaces(
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string,
    @Query(new ZodValidationPipe(SeasonRaceListQuery, FieldErrorCode)) query: SeasonRaceListQuery,
  ): Promise<RacePage> {
    return this.races.listSeasonRaces(id, query);
  }

  /** Гонки маршрута каталога (routes-01): маршрут не в каталоге — 404; модуль `routes` о гонках не знает. */
  @Get('routes/:id/races')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  routeRaces(
    @Param('id', new ZodValidationPipe(Uuid, FieldErrorCode)) id: string,
    @Query(new ZodValidationPipe(CatalogRouteRacesQuery, FieldErrorCode))
    query: CatalogRouteRacesQuery,
  ): Promise<RacePage> {
    return this.races.listRouteRaces(id, query);
  }
}
