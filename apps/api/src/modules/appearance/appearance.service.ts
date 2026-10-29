import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AppAppearance,
  DEFAULT_APP_DECOR_ID,
  DEFAULT_APP_THEME_ID,
  type PanelAppearance,
  type UpdateAppearanceRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit } from '../panel';
import { APPEARANCE_SETTINGS_ID, type AppearanceSettingsDoc } from './appearance.collection';
import { AppearanceRepository } from './appearance.repository';

/** `subject.id` записи журнала о настройке платформы: у платформы нет UUID — фиксированный nil UUID (F3). */
const PLATFORM_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';
const SUBJECT_LABEL = 'Оформление приложения';

/**
 * Оформление приложения: сезонный декор (halloween-decor) — глобальная настройка платформы. Тема — личная
 * (user-theme, ADR-0021: `PUT /v1/profile/theme`); публичный ответ отдаёт `themeId: 'classic'` константой для сборок
 * до личной темы. Приложение читает публично, панель меняет декор по ожидаемой `version` (`appearance.manage`);
 * каждая фактическая смена — запись журнала в той же транзакции. Legacy `themeId` документа не читается и не пишется.
 */
@Injectable()
export class AppearanceService {
  private readonly logger = new Logger(AppearanceService.name);

  constructor(
    private readonly repository: AppearanceRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getPublic(): Promise<AppAppearance> {
    const doc = await this.repository.find();
    return { themeId: DEFAULT_APP_THEME_ID, decor: doc?.decor ?? DEFAULT_APP_DECOR_ID };
  }

  async getPanel(): Promise<PanelAppearance> {
    return toPanelAppearance(await this.repository.find());
  }

  async update(actorUserId: string, input: UpdateAppearanceRequest): Promise<PanelAppearance> {
    const result = await this.transactions.run(async (tx) => {
      const current = await this.repository.find(tx);
      const decorFrom = current?.decor ?? DEFAULT_APP_DECOR_ID;
      if (input.version !== (current?.version ?? 0)) throw domainError('CONFLICT', 409);
      const decorTo = input.decor;
      // повтор того же декора — без записи и без журнала
      if (decorTo === decorFrom) return { doc: current, changed: false };

      const updatedAt = this.clock.now();
      let doc: AppearanceSettingsDoc | null;
      if (current) {
        doc = await this.repository.update(tx, input.version, { decor: decorTo, updatedAt });
      } else {
        doc = { _id: APPEARANCE_SETTINGS_ID, decor: decorTo, version: 1, updatedAt };
        if (!(await this.repository.insert(tx, doc))) doc = null;
      }
      if (!doc) throw domainError('CONFLICT', 409);

      await this.audit.append(tx, {
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'platform', id: PLATFORM_SUBJECT_ID, label: SUBJECT_LABEL },
        action: 'appearance.decor_changed',
        details: { decorFrom, decorTo },
      });
      return { doc, changed: true, from: decorFrom };
    });
    if (result.changed) {
      this.logger.log(`app decor ${result.from} → ${result.doc?.decor ?? DEFAULT_APP_DECOR_ID}`);
    }
    return toPanelAppearance(result.doc);
  }
}

function toPanelAppearance(doc: AppearanceSettingsDoc | null | undefined): PanelAppearance {
  return doc
    ? {
        decor: doc.decor ?? DEFAULT_APP_DECOR_ID,
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
      }
    : { decor: DEFAULT_APP_DECOR_ID, version: 0, updatedAt: null };
}
