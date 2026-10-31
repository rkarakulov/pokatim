import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AvatarId, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PublicReadGuard } from '../../public-read.guard';
import { replyJpeg } from '../media';
import { ProfileAvatarService } from './profile-avatar.service';

/** Кэш аватара: id новый при каждой замене — байты по id не меняются. */
export const AVATAR_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Отдача аватара (rider-profile, ADR-0019): без входа, IP-лимит `public-read`; доступ — по непредсказуемому id
 * (согласие не проверяется — RC-A2). Заголовки файла — `replyJpeg` (`media`) после чтения: 404 уходит JSON-ом и без
 * `immutable`.
 */
@Controller('avatars')
@UseGuards(PublicReadGuard)
export class AvatarsPublicController {
  constructor(
    private readonly avatars: ProfileAvatarService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(AvatarId, FieldErrorCode)) id: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    const bytes = await this.avatars.bytes(id);
    return replyJpeg(this.adapterHost.httpAdapter, reply, bytes, AVATAR_CACHE_CONTROL);
  }
}
