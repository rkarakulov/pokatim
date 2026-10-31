import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FieldErrorCode, RIDE_PHOTO_MAX_BYTES, type RideView, Uuid } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { readLimited } from '../../raw-body';
import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { RidePhotosService } from './ride-photos.service';
import { RIDES_POLICY } from './rides.policy';

/** Ответ Fastify: заголовок закрытия соединения при недочитанном теле. */
interface HeaderReply {
  header(name: string, value: string): unknown;
}

const IMAGE_ERRORS = {
  unsupported: 'IMAGE_FORMAT_UNSUPPORTED',
  tooLarge: 'IMAGE_TOO_LARGE',
} as const;

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * Фото организатора своего райда (ride-photo, ADR-0028) — только для вошедших, пользователь — `@CurrentUser()`.
 * Загрузка — `PUT` сырыми байтами (`application/octet-stream`, ≤ 10 МиБ); права, состояние, слот и лимит — до тела.
 * Удаление — `POST …/delete` по конвенции API. Оба отвечают `RideView`.
 */
@Controller('rides/:id/photo')
@UseGuards(AuthGuard)
export class RidePhotosController {
  constructor(private readonly photos: RidePhotosService) {}

  @Put()
  @Header('Cache-Control', 'no-store')
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<RideView> {
    // отказ до тела (права, состояние, слот, лимит): тело не читалось — после ответа соединение закрывается
    const slot = await this.photos.admit(user.userId, id).catch((error: unknown) => {
      reply.header('Connection', 'close');
      throw error;
    });
    try {
      const bytes = await readLimited(
        body,
        RIDE_PHOTO_MAX_BYTES,
        IMAGE_ERRORS,
        RIDES_POLICY.photoBodyTimeouts,
      ).catch((error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      });
      return await this.photos.replace(user.userId, id, bytes);
    } finally {
      slot.release();
    }
  }

  @Post('delete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  remove(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<RideView> {
    return this.photos.remove(user.userId, id);
  }
}
