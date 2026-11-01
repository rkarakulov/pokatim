import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  DismissRideReportsRequest,
  FieldErrorCode,
  HideRideRequest,
  type ModerationRideDetail,
  type ModerationRidePage,
  ModerationRidePhotoQuery,
  ModerationRideQuery,
  ResetRidePhotoRequest,
  RestoreRideRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { replyJpeg } from '../media';
import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { RIDE_PHOTO_MODERATION_CACHE_CONTROL } from './ride-photos-public.controller';
import { RidePhotosService } from './ride-photos.service';
import { RidesModerationService } from './rides-moderation.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Модерация райдов» панели (05b, `rides.moderate` — admin и moderator); `no-store` ставит `PanelGuard`. */
@Controller('admin/rides')
@UseGuards(PanelGuard)
@RequirePermission('rides.moderate')
export class RidesModerationController {
  constructor(
    private readonly moderation: RidesModerationService,
    private readonly photos: RidePhotosService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ModerationRideQuery, FieldErrorCode)) query: ModerationRideQuery,
  ): Promise<ModerationRidePage> {
    return this.moderation.list(query);
  }

  @Get(':id')
  get(@Param('id', idPipe) id: string): Promise<ModerationRideDetail> {
    return this.moderation.get(id);
  }

  /**
   * Фото райда для карточки модерации (ride-photo-followups, R11 b): текущее фото у любого статуса, `photoId` — из
   * карточки (не текущее — 404). Заголовки — `replyJpeg` после чтения; просмотр не журналируется.
   */
  @Get(':id/photo')
  async photo(
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(ModerationRidePhotoQuery, FieldErrorCode))
    query: ModerationRidePhotoQuery,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    const bytes = await this.photos.moderationBytes(id, query.photoId);
    return replyJpeg(
      this.adapterHost.httpAdapter,
      reply,
      bytes,
      RIDE_PHOTO_MODERATION_CACHE_CONTROL,
    );
  }

  @Post(':id/hide')
  @HttpCode(200)
  hide(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(HideRideRequest, FieldErrorCode)) body: HideRideRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.hide(actor.userId, id, body);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RestoreRideRequest, FieldErrorCode)) body: RestoreRideRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.restore(actor.userId, id, body);
  }

  @Post(':id/dismiss-reports')
  @HttpCode(200)
  dismiss(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DismissRideReportsRequest, FieldErrorCode))
    body: DismissRideReportsRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.dismiss(actor.userId, id, body);
  }

  /** «Удалить фото» организатора (ride-photo): `photoId` из карточки, причина — в журнал. */
  @Post(':id/photo-reset')
  @HttpCode(200)
  resetPhoto(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ResetRidePhotoRequest, FieldErrorCode)) body: ResetRidePhotoRequest,
  ): Promise<ModerationRideDetail> {
    return this.moderation.resetPhoto(actor.userId, id, body);
  }
}
