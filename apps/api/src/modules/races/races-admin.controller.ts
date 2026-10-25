import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CancelRaceRequest,
  DiscardRaceRequest,
  FieldErrorCode,
  type PanelRace,
  type PanelRacePage,
  PanelRaceQuery,
  PublishRaceRequest,
  RaceInput,
  UpdateRaceRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { RacesService } from './races.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/**
 * «Гонки» панели: чтение — `races.read`, изменения — `races.manage` (свои; чужие — с `races.manage_any`, иначе 404 —
 * решает `RacesService` по сессии). Тонкий слой: валидация по контракту и вызов сервиса.
 */
@Controller('admin/races')
@UseGuards(PanelGuard)
export class RacesAdminController {
  constructor(private readonly races: RacesService) {}

  @Get()
  @RequirePermission('races.read')
  list(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Query(new ZodValidationPipe(PanelRaceQuery, FieldErrorCode)) query: PanelRaceQuery,
  ): Promise<PanelRacePage> {
    return this.races.list(actor, query);
  }

  @Get(':id')
  @RequirePermission('races.read')
  get(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
  ): Promise<PanelRace> {
    return this.races.get(actor, id);
  }

  @Post()
  @RequirePermission('races.manage')
  @HttpCode(201)
  create(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(RaceInput, FieldErrorCode)) body: RaceInput,
  ): Promise<PanelRace> {
    return this.races.create(actor, body);
  }

  @Post(':id')
  @RequirePermission('races.manage')
  @HttpCode(200)
  update(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRaceRequest, FieldErrorCode)) body: UpdateRaceRequest,
  ): Promise<PanelRace> {
    return this.races.update(actor, id, body);
  }

  @Post(':id/publish')
  @RequirePermission('races.manage')
  @HttpCode(200)
  publish(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(PublishRaceRequest, FieldErrorCode)) body: PublishRaceRequest,
  ): Promise<PanelRace> {
    return this.races.publish(actor, id, body);
  }

  @Post(':id/cancel')
  @RequirePermission('races.manage')
  @HttpCode(200)
  cancel(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelRaceRequest, FieldErrorCode)) body: CancelRaceRequest,
  ): Promise<PanelRace> {
    return this.races.cancel(actor, id, body);
  }

  @Post(':id/discard')
  @RequirePermission('races.manage')
  @HttpCode(204)
  discard(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DiscardRaceRequest, FieldErrorCode)) body: DiscardRaceRequest,
  ): Promise<void> {
    return this.races.discard(actor, id, body);
  }
}
