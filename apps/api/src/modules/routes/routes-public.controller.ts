import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  type CatalogRouteCities,
  type CatalogRouteDetail,
  type CatalogRoutePage,
  CatalogRouteQuery,
  FieldErrorCode,
  type RouteMapGeometry,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { RoutesPublicService } from './routes-public.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Публичный каталог маршрутов (routes-01): без входа, только опубликованные в каталоге, `Cache-Control: public,
 * max-age=60`, IP-лимит `public-read`. Мутаций здесь нет. Гонки маршрута — `races` (`GET /v1/routes/:id/races`).
 */
@Controller()
@UseGuards(PublicReadGuard)
export class RoutesPublicController {
  constructor(private readonly routes: RoutesPublicService) {}

  @Get('routes')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  list(
    @Query(new ZodValidationPipe(CatalogRouteQuery, FieldErrorCode)) query: CatalogRouteQuery,
  ): Promise<CatalogRoutePage> {
    return this.routes.list(query);
  }

  /** Объявлен до `routes/:id`: иначе `cities` уйдёт в pipe `Uuid` и получит 400. */
  @Get('routes/cities')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  cities(): Promise<CatalogRouteCities> {
    return this.routes.cities();
  }

  @Get('routes/:id')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  get(@Param('id', idPipe) id: string): Promise<CatalogRouteDetail> {
    return this.routes.get(id);
  }

  @Get('routes/:id/map')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  map(@Param('id', idPipe) id: string): Promise<RouteMapGeometry> {
    return this.routes.map(id);
  }
}
