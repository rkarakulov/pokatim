import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AppAppearance,
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
 * Тема приложения (app-themes, T1): глобальная настройка платформы. Приложение читает публично, панель меняет по
 * ожидаемой `version` (`appearance.manage`); каждая фактическая смена — одна запись журнала в той же транзакции.
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
    return { themeId: doc?.themeId ?? DEFAULT_APP_THEME_ID };
  }

  async getPanel(): Promise<PanelAppearance> {
    return toPanelAppearance(await this.repository.find());
  }

  async update(actorUserId: string, input: UpdateAppearanceRequest): Promise<PanelAppearance> {
    const result = await this.transactions.run(async (tx) => {
      const current = await this.repository.find(tx);
      const currentTheme = current?.themeId ?? DEFAULT_APP_THEME_ID;
      if (input.version !== (current?.version ?? 0)) throw domainError('CONFLICT', 409);
      // повтор той же темы — без записи и без журнала
      if (input.themeId === currentTheme) return { doc: current, changed: false };

      const updatedAt = this.clock.now();
      let doc: AppearanceSettingsDoc | null;
      if (current) {
        doc = await this.repository.update(tx, input.version, {
          themeId: input.themeId,
          updatedAt,
        });
      } else {
        doc = { _id: APPEARANCE_SETTINGS_ID, themeId: input.themeId, version: 1, updatedAt };
        if (!(await this.repository.insert(tx, doc))) doc = null;
      }
      if (!doc) throw domainError('CONFLICT', 409);

      await this.audit.append(tx, {
        action: 'appearance.theme_changed',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'platform', id: PLATFORM_SUBJECT_ID, label: SUBJECT_LABEL },
        details: { themeFrom: currentTheme, themeTo: input.themeId },
      });
      return { doc, changed: true, from: currentTheme };
    });
    if (result.changed) this.logger.log(`app theme ${result.from} → ${result.doc?.themeId}`);
    return toPanelAppearance(result.doc);
  }
}

function toPanelAppearance(doc: AppearanceSettingsDoc | null | undefined): PanelAppearance {
  return doc
    ? { themeId: doc.themeId, version: doc.version, updatedAt: doc.updatedAt.toISOString() }
    : { themeId: DEFAULT_APP_THEME_ID, version: 0, updatedAt: null };
}
