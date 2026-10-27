import { Controller, Get, Header, Param, Query, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
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

import {
  IpRateLimit,
  IpRateLimitGuard,
  PUBLIC_READ_CACHE_CONTROL,
  PublicReadGuard,
} from '../../public-read.guard';
import { RoutesPublicService } from './routes-public.service';
import { gpxContentDisposition, ROUTE_POLICY } from './routes.policy';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Публичный каталог маршрутов (routes-01): без входа, только опубликованные в каталоге, `Cache-Control: public,
 * max-age=60`, IP-лимит `public-read` (GPX — ещё и `route-gpx`, routes-03). Мутаций здесь нет. Гонки маршрута — `races` (`GET /v1/routes/:id/races`).
 */
@Controller()
@UseGuards(PublicReadGuard)
export class RoutesPublicController {
  constructor(
    private readonly routes: RoutesPublicService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

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

  /**
   * Очищенный GPX маршрута каталога (routes-03): файл, посчитанный worker'ом (API не разбирает). Заголовки файла
   * ставятся после чтения: Nest пишет `@Header` до обработчика, и 404 с `Content-Type` файла не сериализовался бы
   * в JSON ошибки; 404 и 429 — JSON без `Content-Disposition`. `sandbox` — файл не исполняется.
   */
  @Get('routes/:id/gpx')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('route-gpx', ROUTE_POLICY.gpxIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  async gpx(
    @Param('id', idPipe) id: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    const { bytes, title } = await this.routes.gpx(id);
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(reply, 'Content-Type', 'application/gpx+xml; charset=utf-8');
    adapter.setHeader(reply, 'Content-Disposition', gpxContentDisposition(title));
    adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
    adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
