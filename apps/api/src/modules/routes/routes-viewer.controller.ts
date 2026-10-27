import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type CatalogRouteViewer,
  CreateRouteReportRequest,
  FieldErrorCode,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RouteReportsService } from './route-reports.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Вошедший зритель карточки каталога (routes-06): состояние «Пожаловаться» и жалоба на маршрут райдера. `AuthGuard`,
 * `no-store`; объявлен до публичного `RoutesPublicController` (пути `routes/:id/me`, `routes/:id/reports` — свои
 * сегменты, с публичными не пересекаются).
 */
@Controller('routes')
@UseGuards(AuthGuard)
export class RoutesViewerController {
  constructor(private readonly reports: RouteReportsService) {}

  @Get(':id/me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<CatalogRouteViewer> {
    return this.reports.viewer(user.userId, id);
  }

  @Post(':id/reports')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateRouteReportRequest, FieldErrorCode))
    body: CreateRouteReportRequest,
  ): Promise<CatalogRouteViewer> {
    return this.reports.report(user.userId, id, body);
  }
}
