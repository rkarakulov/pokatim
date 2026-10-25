import { Injectable } from '@nestjs/common';
import type { ProfileView } from '@pokatim/contracts';

import { ProfileRepository } from './profile.repository';

/** Чтение профиля: ответы опроса для порядка разделов Главной; документа нет — пустой ответ. */
@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async view(userId: string): Promise<ProfileView> {
    return { rideReasons: (await this.repository.findReasons(userId)) ?? [] };
  }
}
