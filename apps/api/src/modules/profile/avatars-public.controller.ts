import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AvatarId, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PublicReadGuard } from '../../public-read.guard';
import { ProfileAvatarService } from './profile-avatar.service';

/** Кэш аватара: id новый при каждой замене — байты по id не меняются. */
export const AVATAR_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Отдача аватара (rider-profile, ADR-0018): без входа, IP-лимит `public-read`; доступ — по непредсказуемому id
 * (согласие не проверяется — RC-A2). Заголовки файла ставятся после чтения: Nest пишет `@Header` до обработчика, а 404
 * должен уйти JSON-ом и без `immutable`. `sandbox` и `nosniff` — байты не исполняются и не угадываются.
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
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(reply, 'Content-Type', 'image/jpeg');
    adapter.setHeader(reply, 'Cache-Control', AVATAR_CACHE_CONTROL);
    adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
    adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
    return bytes;
  }
}
