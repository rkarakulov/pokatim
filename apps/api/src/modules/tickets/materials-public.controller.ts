import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { AdminEventParams, type EventMaterial, FieldErrorCode } from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { PUBLIC_READ_CACHE_CONTROL, PublicReadGuard } from '../../public-read.guard';
import { MaterialsRead } from './materials-read';

/** Материалы на карточке события (PR C, RC-C9): без входа, кэш 60 с, IP-лимит `public-read`. */
@Controller('events')
@UseGuards(PublicReadGuard)
export class MaterialsPublicController {
  constructor(private readonly materials: MaterialsRead) {}

  @Get(':kind/:eventId/materials')
  @Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)
  list(
    @Param(new ZodValidationPipe(AdminEventParams, FieldErrorCode)) params: AdminEventParams,
  ): Promise<EventMaterial[]> {
    return this.materials.publicList(params.kind, params.eventId);
  }
}
