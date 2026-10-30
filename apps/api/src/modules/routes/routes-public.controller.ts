import { Controller, Get, Header, Headers, Param, Query, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  type CatalogRouteCities,
  type CatalogRouteDetail,
  type CatalogRoutePage,
  CatalogRouteQuery,
  FieldErrorCode,
  type RouteExportFormat,
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
import {
  acceptsGzip,
  ROUTE_EXPORT_CONTENT_TYPES,
  ROUTE_POLICY,
  routeContentDisposition,
} from './routes.policy';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Публичный каталог маршрутов (routes-01): без входа, только опубликованные в каталоге, `Cache-Control: public,
 * max-age=60`, IP-лимит `public-read` (файлы GPX/KML/TCX — ещё и общий `route-gpx`, routes-03, routes-formats). Мутаций здесь нет. Гонки маршрута — `races` (`GET /v1/routes/:id/races`).
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

  /** Очищенный GPX маршрута каталога (routes-03) — см. `sendExport`. */
  @Get('routes/:id/gpx')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('route-gpx', ROUTE_POLICY.exportIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  gpx(
    @Param('id', idPipe) id: string,
    @Headers('accept-encoding') acceptEncoding: string | undefined,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    return this.sendExport(reply, id, 'gpx', acceptEncoding);
  }

  /** KML маршрута каталога (routes-formats) — тот же бюджет IP-лимита `route-gpx`, что у GPX. */
  @Get('routes/:id/kml')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('route-gpx', ROUTE_POLICY.exportIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  kml(
    @Param('id', idPipe) id: string,
    @Headers('accept-encoding') acceptEncoding: string | undefined,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    return this.sendExport(reply, id, 'kml', acceptEncoding);
  }

  /** TCX (курс) маршрута каталога (routes-formats) — тот же бюджет IP-лимита `route-gpx`, что у GPX. */
  @Get('routes/:id/tcx')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('route-gpx', ROUTE_POLICY.exportIpLimit)
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  tcx(
    @Param('id', idPipe) id: string,
    @Headers('accept-encoding') acceptEncoding: string | undefined,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    return this.sendExport(reply, id, 'tcx', acceptEncoding);
  }

  /**
   * Файл экспорта маршрута каталога: посчитан worker'ом (API не разбирает и не собирает). Заголовки файла ставятся
   * после чтения: Nest пишет `@Header` до обработчика, и 404 с `Content-Type` файла не сериализовался бы в JSON
   * ошибки; 404 и 429 — JSON без `Content-Disposition`. `sandbox` — файл не исполняется. Хранится gzip
   * (route-exports-gzip): клиенту с gzip в `Accept-Encoding` — сжатые байты и `Content-Encoding: gzip`, иначе сервис
   * распаковывает; `Vary: Accept-Encoding` — у каждого 200.
   */
  private async sendExport(
    reply: unknown,
    id: string,
    format: RouteExportFormat,
    acceptEncoding: string | undefined,
  ): Promise<Buffer> {
    const { bytes, contentEncoding, title } = await this.routes.exportFile(
      id,
      format,
      acceptsGzip(acceptEncoding),
    );
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(reply, 'Content-Type', ROUTE_EXPORT_CONTENT_TYPES[format]);
    adapter.setHeader(reply, 'Content-Disposition', routeContentDisposition(title, format));
    adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
    adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
    adapter.setHeader(reply, 'Vary', 'Accept-Encoding');
    if (contentEncoding) adapter.setHeader(reply, 'Content-Encoding', contentEncoding);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
