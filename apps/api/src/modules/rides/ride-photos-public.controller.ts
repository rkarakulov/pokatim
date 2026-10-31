import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FieldErrorCode, RidePhotoId } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PublicReadGuard } from '../../public-read.guard';
import { replyJpeg } from '../media';
import { RidePhotosService } from './ride-photos.service';

/**
 * Кэш фото райда (ADR-0028, R6): id новый при каждой замене (`immutable`), но фото снимают модерация, скрытие райда и
 * удаление аккаунта — сутки, а не год, как у аватара.
 */
export const RIDE_PHOTO_CACHE_CONTROL = 'public, max-age=86400, immutable';

/**
 * Отдача фото райда (ride-photo): без входа, IP-лимит `public-read`; доступ — по непредсказуемому id и только пока это
 * текущее фото нескрытого райда (иначе 404 всем, включая организатора). Заголовки — `replyJpeg` после чтения.
 */
@Controller('ride-photos')
@UseGuards(PublicReadGuard)
export class RidePhotosPublicController {
  constructor(
    private readonly photos: RidePhotosService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(RidePhotoId, FieldErrorCode)) id: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    const bytes = await this.photos.bytes(id);
    return replyJpeg(this.adapterHost.httpAdapter, reply, bytes, RIDE_PHOTO_CACHE_CONTROL);
  }
}
