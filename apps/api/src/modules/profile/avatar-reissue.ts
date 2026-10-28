import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { ProfileAvatarRepository } from './profile-avatar.repository';
import { ProfileRepository } from './profile.repository';

/**
 * Перевыпуск id фото (profile-moderation, RC-A2 (b), ADR-0019): профиль перестал быть публичным — фото копируется под
 * новый непредсказуемый id, старый документ удаляется: прежний URL (мог разойтись, пока профиль был публичен) — 404,
 * своё фото у райдера работает по новому id. Вызывается в транзакции записи профиля **после** первой записи профиля;
 * новый id — `randomToken()` до транзакции (колбэк идемпотентен при повторе).
 */
@Injectable()
export class AvatarReissue {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly avatars: ProfileAvatarRepository,
  ) {}

  /** Новый id фото; `null` — документа фото уже нет (гонка удаления): `avatarId` профиля обнуляется. */
  async reissue(
    tx: DbSession,
    userId: string,
    oldId: string,
    newId: string,
    now: Date,
  ): Promise<string | null> {
    const doc = await this.avatars.findForCopy(tx, oldId, userId);
    if (!doc) {
      await this.profiles.replaceAvatarId(tx, userId, oldId, null, now);
      return null;
    }
    await this.avatars.insert(tx, { ...doc, _id: newId });
    await this.profiles.replaceAvatarId(tx, userId, oldId, newId, now);
    await this.avatars.delete(tx, oldId, userId);
    return newId;
  }
}
