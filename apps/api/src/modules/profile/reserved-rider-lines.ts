import { Injectable } from '@nestjs/common';
import { isReservedRiderLine } from '@pokatim/contracts';

import { ProfileRepository } from './profile.repository';

const PAGE = 500;

/** Поле профиля со служебной подписью таблицы результатов. */
export type ReservedRiderField = 'name' | 'club';

/**
 * Разовая выборка имён и клубов, сохранённых до запрета служебных подписей (name-consent-prompt N8: «Райдер #N»,
 * «Участник», «Вы»): профили, где имя или клуб совпадает с подписью. Только чтение — сбрасывает модератор в панели
 * (Q3, журнал действий). Значения наружу не отдаются: только id пользователя и поля.
 */
@Injectable()
export class ReservedRiderLines {
  constructor(private readonly repository: ProfileRepository) {}

  async find(): Promise<{ userId: string; fields: ReservedRiderField[] }[]> {
    const found: { userId: string; fields: ReservedRiderField[] }[] = [];
    for (let after: string | null = null; ;) {
      const page = await this.repository.linesPage(after, PAGE);
      for (const doc of page) {
        const fields: ReservedRiderField[] = [];
        if (typeof doc.publicName === 'string' && isReservedRiderLine(doc.publicName))
          fields.push('name');
        if (typeof doc.club === 'string' && isReservedRiderLine(doc.club)) fields.push('club');
        if (fields.length > 0) found.push({ userId: doc._id, fields });
      }
      if (page.length < PAGE) return found;
      after = page.at(-1)!._id;
    }
  }
}
