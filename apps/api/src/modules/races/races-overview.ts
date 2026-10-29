import { Injectable } from '@nestjs/common';

import type { PanelPrincipal } from '../panel';
import { toRace } from './race-registry';
import type { RaceForResults } from './race-registry.port';
import { ownScope, RACE_POLICY } from './races.policy';
import { RacesRepository } from './races.repository';

/** Гонки одной фазы «Обзора»: всего и первые `limit` (раньше закрывающиеся — первыми). */
export interface OverviewRaces {
  total: number;
  races: RaceForResults[];
}

/**
 * Порт `races` для «Обзора» панели (admin-overview, модуль `overview`): гонки с открытым окном и гонки, ждущие
 * публикации протокола (фазы `open` и `closed` из `racePhase`). Видимость — как в панели гонок (`ownScope`:
 * организатор — только свои). Только чтение.
 */
@Injectable()
export class RacesOverview {
  constructor(private readonly repository: RacesRepository) {}

  openWindow(principal: PanelPrincipal, now: Date, limit: number): Promise<OverviewRaces> {
    return this.list('open', principal, now, limit);
  }

  awaitingProtocol(principal: PanelPrincipal, now: Date, limit: number): Promise<OverviewRaces> {
    return this.list('closed', principal, now, limit);
  }

  private async list(
    phase: 'open' | 'closed',
    principal: PanelPrincipal,
    now: Date,
    limit: number,
  ): Promise<OverviewRaces> {
    const { total, docs } = await this.repository.overviewRaces(
      phase,
      {
        now,
        closedBefore: new Date(now.getTime() - RACE_POLICY.windowEndGraceMs),
        ownerUserId: ownScope(principal) ? principal.userId : undefined,
      },
      limit,
    );
    return { total, races: docs.map(toRace) };
  }
}
