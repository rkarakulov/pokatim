import { Injectable } from '@nestjs/common';
import { type AchievementCode, isSeasonalCode, minskToday } from '@pokatim/contracts';

import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementObjects, objectKey } from './achievement-objects';
import { levelName } from './achievements.policy';
import type { AchievementCardFacts, AchievementsForSharing } from './achievements-for-sharing.port';
import { AchievementsRepository } from './achievements.repository';

/**
 * Реализация `ACHIEVEMENTS_FOR_SHARING`: факты читателя ∩ не отозванная выдача; без записей. Ручная выдача
 * (achievements-panel, RC-1) — объект, дата и уровень из документа, название — `AchievementObjects`; ручной отзыв —
 * `revokedAt` → `null`. У сезонных карточки нет (S7) — `null` (409).
 */
@Injectable()
export class AchievementsSharing implements AchievementsForSharing {
  constructor(
    private readonly facts: AchievementFactsReader,
    private readonly repository: AchievementsRepository,
    private readonly objects: AchievementObjects,
  ) {}

  async cardFacts(userId: string, code: AchievementCode): Promise<AchievementCardFacts | null> {
    if (isSeasonalCode(code)) return null;
    const [{ earned }, grants] = await Promise.all([
      this.facts.evaluate(userId),
      this.repository.listOf(userId),
    ]);
    const grant = grants.find((doc) => doc.code === code && doc.revokedAt === null);
    if (grant?.override?.decision === 'granted') {
      const title = (await this.objects.titles(userId, [grant.object])).get(
        objectKey(grant.object),
      );
      if (title === undefined) return null;
      return {
        code,
        object: { kind: grant.object.kind, id: grant.object.id, title },
        factDate: minskToday(grant.factAt),
        level: grant.level == null ? null : levelName(grant.level),
      };
    }
    const item = earned.get(code);
    if (!item || !grant) return null;
    const [titled] = await this.facts.titled(new Map([[code, item]]), userId);
    if (!titled) return null;
    return {
      code,
      object: { kind: titled.object.kind, id: titled.object.id, title: titled.title },
      factDate: minskToday(titled.factAt),
      level: titled.level === null ? null : levelName(titled.level),
    };
  }
}
