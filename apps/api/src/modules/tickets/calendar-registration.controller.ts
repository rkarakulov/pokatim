import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CalendarRegistrationRequest,
  type CalendarRegistrationState,
  FieldErrorCode,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { CalendarRegistrationService } from './calendar-registration.service';

/** Ответ Fastify: код статуса (201 — новая регистрация, 200 — уже зарегистрирован). */
interface StatusReply {
  status(code: number): unknown;
}

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
const EmptyBody = z.strictObject({}).optional();

/**
 * Регистрация на старт календаря в «Покатим» (event-tickets): только вошедшие, только своя, `no-store`. Путь
 * `calendar/:id/registration` не пересекается с публичным `calendar/:id` (другой сегмент).
 */
@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarRegistrationController {
  constructor(private readonly registrations: CalendarRegistrationService) {}

  @Get(':id/registration')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<CalendarRegistrationState> {
    return this.registrations.get(user.userId, id);
  }

  @Post(':id/registration')
  @Header('Cache-Control', 'no-store')
  async register(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CalendarRegistrationRequest.optional(), FieldErrorCode))
    body: CalendarRegistrationRequest | undefined,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<CalendarRegistrationState> {
    const result = await this.registrations.register(user.userId, id, body ?? {});
    reply.status(result.created ? 201 : 200);
    return result.state;
  }

  @Post(':id/registration/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Body(new ZodValidationPipe(EmptyBody, FieldErrorCode)) _body: unknown,
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<CalendarRegistrationState> {
    return this.registrations.cancel(user.userId, id);
  }
}
