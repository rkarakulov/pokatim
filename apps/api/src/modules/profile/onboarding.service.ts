import { Inject, Injectable } from '@nestjs/common';
import type { OnboardingStatus, RideReason } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { ProfileRepository } from './profile.repository';

/**
 * Онбординг профиля: опрос «Что вас привело?». Сервер опрос не навязывает (R8): другие эндпоинты ответа не
 * требуют. Наружу — только признак «пройден».
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repository: ProfileRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async status(userId: string): Promise<OnboardingStatus> {
    return this.repository.onboardingFlags(userId);
  }

  /** Идемпотентно: повтор после потерянного ответа даёт тот же итог; новый набор заменяет прежний. */
  async submit(userId: string, reasons: RideReason[]): Promise<OnboardingStatus> {
    const now = this.clock.now();
    try {
      await this.repository.upsertSurvey(userId, reasons, now);
    } catch (error) {
      // гонка двух первых upsert (R12): документ уже вставлен — повтор его найдёт и обновит
      if (!isDuplicateKey(error, '_id_')) throw error;
      await this.repository.upsertSurvey(userId, reasons, now);
    }
    return this.repository.onboardingFlags(userId);
  }

  /**
   * Шаг «Подключите устройство» (tracks-devices, R12): любой исход (`connected`, `later`) отмечает шаг пройденным для
   * аккаунта — другое устройство его не показывает. Идемпотентно; гонка первых upsert — как у опроса.
   */
  async completeDevicesStep(userId: string): Promise<OnboardingStatus> {
    const now = this.clock.now();
    try {
      await this.repository.markDevicesStep(userId, now);
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      await this.repository.markDevicesStep(userId, now);
    }
    return this.repository.onboardingFlags(userId);
  }
}
