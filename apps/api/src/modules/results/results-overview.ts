import { Injectable } from '@nestjs/common';

import type { RaceForResults } from '../races';
import { ResultsPanelReadService } from './results-panel-read.service';
import { ResultsRepository } from './results.repository';

/** Готовность протоколов ждущих гонок: готовы к публикации и сумма невыполненных пунктов чек-листа. */
export interface ProtocolReadiness {
  ready: number;
  blockers: number;
}

/**
 * Порт `results` для «Обзора» панели (admin-overview, модуль `overview`): готовность протоколов — тот же чек-лист,
 * что в «Результатах» гонки (`ResultsPanelReadService.checks` → `publishChecklist`), и активность гонок с открытым
 * окном. Только чтение.
 */
@Injectable()
export class ResultsOverview {
  constructor(
    private readonly read: ResultsPanelReadService,
    private readonly repository: ResultsRepository,
  ) {}

  /**
   * Блокер — пункт чек-листа с ненулевым счётчиком или состояние гонки, запрещающее публикацию (`blockedBy`). Чек-лист
   * — несколько запросов на гонку: гонки по одной, их немного (лимит вызывающего).
   */
  async protocolReadiness(races: readonly RaceForResults[], now: Date): Promise<ProtocolReadiness> {
    const readiness: ProtocolReadiness = { ready: 0, blockers: 0 };
    for (const race of races) {
      const { publish } = await this.read.checks(race, now);
      if (publish.canPublish) readiness.ready += 1;
      readiness.blockers +=
        publish.checklist.filter((row) => row.count > 0).length + (publish.blockedBy ? 1 : 0);
    }
    return readiness;
  }

  raceActivity(
    raceIds: readonly string[],
  ): Promise<Map<string, { participants: number; attempts: number }>> {
    return this.repository.raceActivity(raceIds);
  }
}
