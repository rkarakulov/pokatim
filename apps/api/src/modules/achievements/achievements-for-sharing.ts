import { Injectable } from '@nestjs/common';
import { type AchievementCode, minskToday } from '@pokatim/contracts';

import { AchievementFactsReader } from './achievement-facts.reader';
import { levelName } from './achievements.policy';
import type { AchievementCardFacts, AchievementsForSharing } from './achievements-for-sharing.port';
import { AchievementsRepository } from './achievements.repository';

/** Реализация `ACHIEVEMENTS_FOR_SHARING`: факты читателя ∩ не отозванная выдача; без записей. */
@Injectable()
export class AchievementsSharing implements AchievementsForSharing {
  constructor(
    private readonly facts: AchievementFactsReader,
    private readonly repository: AchievementsRepository,
  ) {}

  async cardFacts(userId: string, code: AchievementCode): Promise<AchievementCardFacts | null> {
    const [{ earned }, grants] = await Promise.all([
      this.facts.evaluate(userId),
      this.repository.listOf(userId),
    ]);
    const item = earned.get(code);
    const granted = grants.some((grant) => grant.code === code && grant.revokedAt === null);
    if (!item || !granted) return null;
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
