import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AVATAR_MAX_BYTES,
  AvatarCropQuery,
  FieldErrorCode,
  type ProfileView,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { DEFAULT_BODY_TIMEOUTS, readLimited } from '../../raw-body';
import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { ProfileAvatarService } from './profile-avatar.service';

/** Ответ Fastify: заголовок закрытия соединения при недочитанном теле. */
interface HeaderReply {
  header(name: string, value: string): unknown;
}

const AVATAR_ERRORS = {
  unsupported: 'AVATAR_FORMAT_UNSUPPORTED',
  tooLarge: 'AVATAR_TOO_LARGE',
} as const;

/**
 * Фото своего профиля (rider-profile) — только для вошедших. Загрузка — `PUT` сырыми байтами
 * (`application/octet-stream`, ≤ 10 МиБ), query обрезки проверяется до слота и тела. Удаление — `POST …/delete` по
 * конвенции API (RC-A5). Оба отвечают `ProfileView`.
 */
@Controller('profile/avatar')
@UseGuards(AuthGuard)
export class ProfileAvatarsController {
  constructor(private readonly avatars: ProfileAvatarService) {}

  @Put()
  @Header('Cache-Control', 'no-store')
  async upload(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AvatarCropQuery, FieldErrorCode)) crop: AvatarCropQuery,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<ProfileView> {
    const slot = await this.avatars.admit(user.userId);
    try {
      const bytes = await readLimited(
        body,
        AVATAR_MAX_BYTES,
        AVATAR_ERRORS,
        DEFAULT_BODY_TIMEOUTS,
      ).catch((error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      });
      return await this.avatars.replace(user.userId, bytes, crop);
    } finally {
      slot.release();
    }
  }

  @Post('delete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  remove(@CurrentUser() user: AuthUser): Promise<ProfileView> {
    return this.avatars.remove(user.userId);
  }
}
