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
  type AttemptCandidates,
  AttemptRequest,
  FieldErrorCode,
  type MyRaceEntry,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { AttemptsService } from './attempts.service';
import { EntriesService } from './entries.service';
import { ResultsReadService } from './results-read.service';

/** Ответ Fastify: код статуса (201 — новая заявка, 200 — уже заявлен). */
interface StatusReply {
  status(code: number): unknown;
}

const raceIdPipe = new ZodValidationPipe(Uuid, FieldErrorCode);
/** Тело мутаций без данных: пустой объект или без тела (клиент присылает только намерение). */
const EmptyBody = z.strictObject({}).optional();

/**
 * Участие в гонке (race-results-03) — только вошедшие, `no-store`: моё участие, заявка, отмена, явная попытка,
 * кандидаты «своих заездов». Пользователь — из access (`@CurrentUser`), не из запроса.
 */
@Controller('races')
@UseGuards(AuthGuard)
export class RaceEntryController {
  constructor(
    private readonly entries: EntriesService,
    private readonly attempts: AttemptsService,
    private readonly read: ResultsReadService,
  ) {}

  @Get(':raceId/entry')
  @Header('Cache-Control', 'no-store')
  myEntry(
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<MyRaceEntry> {
    return this.read.myEntry(user.userId, raceId);
  }

  @Post(':raceId/entry')
  @Header('Cache-Control', 'no-store')
  async enter(
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
    @Body(new ZodValidationPipe(EmptyBody, FieldErrorCode)) _body: unknown,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<MyRaceEntry> {
    const result = await this.entries.enter(user.userId, raceId);
    reply.status(result.created ? 201 : 200);
    return result.entry;
  }

  @Post(':raceId/entry/withdraw')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  withdraw(
    @Body(new ZodValidationPipe(EmptyBody, FieldErrorCode)) _body: unknown,
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<MyRaceEntry> {
    return this.entries.withdraw(user.userId, raceId);
  }

  @Post(':raceId/attempts')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  addAttempt(
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
    @Body(new ZodValidationPipe(AttemptRequest, FieldErrorCode)) body: AttemptRequest,
  ): Promise<MyRaceEntry> {
    return this.attempts.add(user.userId, raceId, body);
  }

  @Get(':raceId/attempt-candidates')
  @Header('Cache-Control', 'no-store')
  candidates(
    @CurrentUser() user: AuthUser,
    @Param('raceId', raceIdPipe) raceId: string,
  ): Promise<AttemptCandidates> {
    return this.attempts.candidates(user.userId, raceId);
  }
}
