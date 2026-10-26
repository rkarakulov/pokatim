import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelRoute,
  type PanelRoutePage,
  PanelRouteQuery,
  UploadRouteQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { readLimited } from '../../raw-body';
import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesService } from './routes.service';

/** Ответ Fastify: код статуса (202 — новый маршрут, 200 — тот же файл) и заголовок. */
interface StatusReply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const UPLOAD_ERRORS = {
  unsupported: 'ROUTE_FORMAT_UNSUPPORTED',
  tooLarge: 'ROUTE_TOO_LARGE',
} as const;

/**
 * Маршруты коридора в панели (race-results-01): загрузка GPX — `races.manage`, чтение — `races.read` (Q1). Тонкий
 * слой: гард, права, контракт, чтение тела после лимита частоты; разбор — только worker.
 */
@Controller('admin/routes')
@UseGuards(PanelGuard)
export class RoutesAdminController {
  constructor(private readonly routes: RoutesService) {}

  @Post()
  @RequirePermission('races.manage')
  @Header('Cache-Control', 'no-store')
  async upload(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Query(new ZodValidationPipe(UploadRouteQuery, FieldErrorCode)) query: UploadRouteQuery,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<PanelRoute> {
    await this.routes.admit(actor);
    const bytes = await readLimited(body, ROUTE_POLICY.maxFileBytes, UPLOAD_ERRORS).catch(
      (error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      },
    );
    const result = await this.routes.accept(actor, query.title, bytes);
    reply.status(result.created ? 202 : 200);
    return result.route;
  }

  @Get()
  @RequirePermission('races.read')
  list(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Query(new ZodValidationPipe(PanelRouteQuery, FieldErrorCode)) query: PanelRouteQuery,
  ): Promise<PanelRoutePage> {
    return this.routes.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('races.read')
  get(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
  ): Promise<PanelRoute> {
    return this.routes.get(actor, id);
  }
}
