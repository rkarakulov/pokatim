import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EventMaterialFileId } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import { IpRateLimit, IpRateLimitGuard, PublicReadGuard } from '../../public-read.guard';
import { contentDisposition, MATERIALS_POLICY } from './materials.policy';
import { MaterialsRepository } from './materials.repository';

/** Кэш PDF: id новый у каждого файла — байты по id не меняются (удаление — 404). */
export const EVENT_FILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Отдача PDF материала (PR C, ADR-0023 «Материалы»): без входа, IP-лимиты `public-read` и `event-file`; доступ — по
 * негадаемому id (как аватар ADR-0019, событие не проверяется — RC-C9). Заголовки — после чтения: 404 уходит JSON-ом
 * без `immutable`. `attachment` (RC-C3), `sandbox`, `nosniff`, `no-referrer` — байты не исполняются на нашем origin.
 * Кривой id — тот же 404.
 */
@Controller('event-files')
@UseGuards(PublicReadGuard)
export class EventFilesController {
  constructor(
    private readonly repository: MaterialsRepository,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get(':fileId')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit('event-file', MATERIALS_POLICY.fileIpLimit)
  async get(
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<Buffer> {
    // кривой id — тот же 404, что «нет файла» (не 400: id не форма)
    const file = EventMaterialFileId.safeParse(fileId).success
      ? await this.repository.findFile(fileId)
      : null;
    if (!file) throw domainError('NOT_FOUND', 404);
    const bytes = Buffer.from(file.bytes);
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(reply, 'Content-Type', 'application/pdf');
    adapter.setHeader(reply, 'Content-Length', String(bytes.byteLength));
    adapter.setHeader(reply, 'Content-Disposition', contentDisposition(file.fileName));
    adapter.setHeader(reply, 'Cache-Control', EVENT_FILE_CACHE_CONTROL);
    adapter.setHeader(reply, 'X-Content-Type-Options', 'nosniff');
    adapter.setHeader(reply, 'Content-Security-Policy', "default-src 'none'; sandbox");
    adapter.setHeader(reply, 'Referrer-Policy', 'no-referrer');
    return bytes;
  }
}
