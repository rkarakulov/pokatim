import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateProfileReportRequest,
  FieldErrorCode,
  RiderPublicId,
  type RiderProfileViewer,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { ProfileReportsService } from './profile-reports.service';

const publicIdPipe = new ZodValidationPipe(RiderPublicId, FieldErrorCode);

/**
 * Вошедший зритель публичного профиля (profile-moderation, RC-P6): состояние «Пожаловаться» и жалоба. `AuthGuard`,
 * `no-store`. Публичное чтение `riders/:publicId` — модуль `riders` (`PublicReadGuard`); пути `me`/`reports` — свои
 * сегменты, с публичными не пересекаются (данные жалоб — у `profile`).
 */
@Controller('riders')
@UseGuards(AuthGuard)
export class RiderReportsController {
  constructor(private readonly reports: ProfileReportsService) {}

  @Get(':publicId/me')
  @Header('Cache-Control', 'no-store')
  me(
    @CurrentUser() user: AuthUser,
    @Param('publicId', publicIdPipe) publicId: string,
  ): Promise<RiderProfileViewer> {
    return this.reports.viewer(user.userId, publicId);
  }

  @Post(':publicId/reports')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  report(
    @CurrentUser() user: AuthUser,
    @Param('publicId', publicIdPipe) publicId: string,
    @Body(new ZodValidationPipe(CreateProfileReportRequest, FieldErrorCode))
    body: CreateProfileReportRequest,
  ): Promise<RiderProfileViewer> {
    return this.reports.report(user.userId, publicId, body);
  }
}
