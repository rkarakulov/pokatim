import { Controller, Get, UseGuards } from '@nestjs/common';
import type { PanelOverview } from '@pokatim/contracts';

import { CurrentPanelUser, PanelGuard, type PanelPrincipal } from '../panel';
import { OverviewService } from './overview.service';

/**
 * «Обзор» панели (admin-overview): видят все роли — права нет на маршруте, блоки режет сервис по правам сотрудника;
 * `no-store` ставит `PanelGuard`.
 */
@Controller('admin/overview')
@UseGuards(PanelGuard)
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  get(@CurrentPanelUser() principal: PanelPrincipal): Promise<PanelOverview> {
    return this.overview.overview(principal);
  }
}
