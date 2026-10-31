import { Body, Controller, Get, Header, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  RiderPublicId,
  type RiderSocial,
  SetRiderConnectionRequest,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RiderSocialService } from './rider-social.service';

const publicIdPipe = new ZodValidationPipe(RiderPublicId, FieldErrorCode);

/**
 * «Свои» на чужом профиле (P3, K6, ADR-0027 п. 3): состояние вошедшего зрителя и «В свои» / «Убрать». `AuthGuard`,
 * `no-store`. Публичное `riders/:publicId` (модуль `riders`) и `riders/:publicId/{me,reports}` (`profile`) — другие
 * сегменты пути.
 */
@Controller('riders')
@UseGuards(AuthGuard)
export class RiderSocialController {
  constructor(private readonly social: RiderSocialService) {}

  @Get(':publicId/social')
  @Header('Cache-Control', 'no-store')
  view(
    @CurrentUser() user: AuthUser,
    @Param('publicId', publicIdPipe) publicId: string,
  ): Promise<RiderSocial> {
    return this.social.view(user.userId, publicId);
  }

  /** Идемпотентно: `{ connected: true }` — «В свои» (лимит K11), `false` — тихо убрать (K1). */
  @Put(':publicId/social/connection')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  setConnection(
    @CurrentUser() user: AuthUser,
    @Param('publicId', publicIdPipe) publicId: string,
    @Body(new ZodValidationPipe(SetRiderConnectionRequest, FieldErrorCode))
    body: SetRiderConnectionRequest,
  ): Promise<RiderSocial> {
    return this.social.setConnection(user.userId, publicId, body.connected);
  }
}
