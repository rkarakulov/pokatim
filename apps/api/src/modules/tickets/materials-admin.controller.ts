import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AdminEventParams,
  type EventMaterialAdmin,
  EventMaterialInput,
  EventMaterialParams,
  type EventMaterialsAdmin,
  EventMaterialUploadQuery,
  FieldErrorCode,
  ReorderEventMaterialsRequest,
  UpdateEventMaterialRequest,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { readLimited } from '../../raw-body';
import { CurrentPanelUser, PanelGuard, type PanelPrincipal } from '../panel';
import { MaterialsAdminService } from './materials-admin.service';
import { MATERIALS_POLICY } from './materials.policy';

interface HeaderReply {
  header(name: string, value: string): unknown;
}

const paramsPipe = new ZodValidationPipe(AdminEventParams, FieldErrorCode);
const materialPipe = new ZodValidationPipe(EventMaterialParams, FieldErrorCode);
const UPLOAD_ERRORS = {
  unsupported: 'MATERIAL_FILE_UNSUPPORTED',
  tooLarge: 'MATERIAL_FILE_TOO_LARGE',
} as const;

/**
 * Материалы события в панели (event-tickets PR C). `PanelGuard` без права на маршруте: право зависит от `kind`
 * (`races.manage` своих / `calendar.manage`) — проверка `PanelEvents` в сервисе, как у настроек билетов (RC-T9).
 * Статические `materials/files` и `materials/order` объявлены до `materials/:materialId`.
 */
@Controller('admin/events')
@UseGuards(PanelGuard)
export class MaterialsAdminController {
  constructor(private readonly materials: MaterialsAdminService) {}

  @Get(':kind/:eventId/materials')
  list(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
  ): Promise<EventMaterialsAdmin> {
    return this.materials.list(principal, params.kind, params.eventId);
  }

  @Post(':kind/:eventId/materials')
  create(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
    @Body(new ZodValidationPipe(EventMaterialInput, FieldErrorCode)) body: EventMaterialInput,
  ): Promise<EventMaterialAdmin> {
    return this.materials.create(principal, params.kind, params.eventId, body);
  }

  /** PDF сырыми байтами; метаданные — query. Тело читается после доступа и лимитов; отказ — `Connection: close`. */
  @Post(':kind/:eventId/materials/files')
  @Header('Cache-Control', 'no-store')
  upload(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
    @Query(new ZodValidationPipe(EventMaterialUploadQuery, FieldErrorCode))
    query: EventMaterialUploadQuery,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: HeaderReply,
  ): Promise<EventMaterialAdmin> {
    return this.materials.upload(principal, params.kind, params.eventId, query, () =>
      readLimited(
        body,
        MATERIALS_POLICY.fileMaxBytes,
        UPLOAD_ERRORS,
        MATERIALS_POLICY.bodyTimeouts,
      ).catch((error: unknown) => {
        // тело не дочитано — после ответа соединение закрывается
        reply.header('Connection', 'close');
        throw error;
      }),
    );
  }

  @Put(':kind/:eventId/materials/order')
  reorder(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(paramsPipe) params: AdminEventParams,
    @Body(new ZodValidationPipe(ReorderEventMaterialsRequest, FieldErrorCode))
    body: ReorderEventMaterialsRequest,
  ): Promise<EventMaterialsAdmin> {
    return this.materials.reorder(principal, params.kind, params.eventId, body);
  }

  @Patch(':kind/:eventId/materials/:materialId')
  update(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(materialPipe) params: EventMaterialParams,
    @Body(new ZodValidationPipe(UpdateEventMaterialRequest, FieldErrorCode))
    body: UpdateEventMaterialRequest,
  ): Promise<EventMaterialAdmin> {
    return this.materials.update(principal, params.kind, params.eventId, params.materialId, body);
  }

  @Post(':kind/:eventId/materials/:materialId/delete')
  @HttpCode(204)
  remove(
    @CurrentPanelUser() principal: PanelPrincipal,
    @Param(materialPipe) params: EventMaterialParams,
  ): Promise<void> {
    return this.materials.remove(principal, params.kind, params.eventId, params.materialId);
  }
}
