import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  FieldErrorCode,
  type TrackUpload,
  type TrackUploadPage,
  TrackUploadQuery,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { readLimited } from '../../raw-body';
import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { TRACKS_POLICY } from './tracks.policy';
import { TrackUploadsService } from './track-uploads.service';

/** Ответ Fastify: только код статуса (202 — новая загрузка, 200 — тот же файл). */
interface StatusReply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

const UploadId = new ZodValidationPipe(Uuid, FieldErrorCode);
const UPLOAD_ERRORS = {
  unsupported: 'TRACK_FORMAT_UNSUPPORTED',
  tooLarge: 'TRACK_TOO_LARGE',
} as const;

/** Ручная загрузка заездов и свои загрузки — только для вошедших (§8.3 п. 1); чужая — 404. */
@Controller('tracks/uploads')
@UseGuards(AuthGuard)
export class TrackUploadsController {
  constructor(private readonly uploads: TrackUploadsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  async upload(
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Query('name') rawName: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: StatusReply,
  ): Promise<TrackUpload> {
    const fileName = this.uploads.parseName(rawName);
    const slot = await this.uploads.admit(user.userId, ip);
    try {
      const bytes = await readLimited(
        body,
        TRACKS_POLICY.maxFileBytes,
        UPLOAD_ERRORS,
        TRACKS_POLICY.bodyTimeouts,
      ).catch((error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      });
      const result = await this.uploads.accept(user.userId, fileName, bytes);
      reply.status(result.created ? 202 : 200);
      return result.upload;
    } finally {
      slot.release();
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(TrackUploadQuery, FieldErrorCode)) query: TrackUploadQuery,
  ): Promise<TrackUploadPage> {
    return this.uploads.list(user.userId, query.cursor, query.limit);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthUser, @Param('id', UploadId) id: string): Promise<TrackUpload> {
    return this.uploads.get(user.userId, id);
  }

  @Post(':id/delete')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async delete(@CurrentUser() user: AuthUser, @Param('id', UploadId) id: string): Promise<void> {
    await this.uploads.delete(user.userId, id);
  }
}
