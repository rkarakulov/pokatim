import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  FieldErrorCode,
  type PanelSeason,
  type PanelSeasonList,
  SeasonInput,
  UpdateSeasonRequest,
  Uuid,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal, RequirePermission } from '../panel';
import { SeasonsService } from './seasons.service';

const idPipe = new ZodValidationPipe(Uuid, FieldErrorCode);

/** «Сезоны» панели: чтение — `races.read` (admin, moderator, organizer), изменение — `seasons.manage` (admin). */
@Controller('admin/seasons')
@UseGuards(PanelGuard)
export class SeasonsAdminController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  @RequirePermission('races.read')
  list(): Promise<PanelSeasonList> {
    return this.seasons.list();
  }

  @Post()
  @RequirePermission('seasons.manage')
  @HttpCode(201)
  create(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Body(new ZodValidationPipe(SeasonInput, FieldErrorCode)) body: SeasonInput,
  ): Promise<PanelSeason> {
    return this.seasons.create(actor.userId, body);
  }

  @Post(':id')
  @RequirePermission('seasons.manage')
  @HttpCode(200)
  update(
    @CurrentPanelUser() actor: PanelPrincipal,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSeasonRequest, FieldErrorCode)) body: UpdateSeasonRequest,
  ): Promise<PanelSeason> {
    return this.seasons.update(actor.userId, id, body);
  }
}
