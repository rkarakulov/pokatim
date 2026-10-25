import type { Readable } from 'node:stream';

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

import { domainError } from '../../error-messages';
import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { TRACKS_POLICY } from './tracks.policy';
import { TrackUploadsService } from './track-uploads.service';

/** Ответ Fastify: только код статуса (202 — новая загрузка, 200 — тот же файл). */
interface StatusReply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

/**
 * Тело загрузки — сырой поток (`application/octet-stream`, парсер `http-app.ts` передаёт его без чтения): читается
 * здесь, после гарда и лимитов, с обрывом на лимите — `413 TRACK_TOO_LARGE` с кодом контракта (глобальный
 * `bodyLimit` 64 КБ остальных маршрутов не меняется). Другой тип содержимого — `415`.
 */
function readLimited(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (!isReadable(body)) return Promise.reject(domainError('TRACK_FORMAT_UNSUPPORTED', 415));
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > maxBytes) {
        // не рвём соединение (клиент получил бы обрыв вместо 413): остаток тела сливается без хранения, ответ
        // 413 уходит с `Connection: close`
        cleanup();
        body.resume();
        reject(domainError('TRACK_TOO_LARGE', 413));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      resolve(new Uint8Array(Buffer.concat(chunks, size)));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      body.off('data', onData);
      body.off('end', onEnd);
      body.off('error', onError);
    };
    body.on('data', onData);
    body.once('end', onEnd);
    body.once('error', onError);
  });
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readable).pipe === 'function' &&
    typeof (value as Readable)[Symbol.asyncIterator] === 'function'
  );
}

const UploadId = new ZodValidationPipe(Uuid, FieldErrorCode);

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
      const bytes = await readLimited(body, TRACKS_POLICY.maxFileBytes).catch((error: unknown) => {
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
