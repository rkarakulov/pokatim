import { Injectable } from '@nestjs/common';

import { TrackUploadsService } from './track-uploads.service';
import { TracksRepository } from './tracks.repository';

/**
 * Порт стирания заездов удалённого аккаунта (модуль `account`, ADR-0015, A7): каждая загрузка — тем же каскадом, что
 * удаление владельцем (`TrackUploadsService.remove`: активность, линия, перевыбор основной, outbox
 * `tracks.activity-removed` — попытки снимает `results`, файл, кэш места), затем маркеры источника и замок
 * активностей (F5). Вызывается после шага устройств — новых приёмов от провайдера нет. Повторяемо.
 */
@Injectable()
export class TrackErasure {
  constructor(
    private readonly repository: TracksRepository,
    private readonly uploads: TrackUploadsService,
  ) {}

  async erase(userId: string): Promise<number> {
    let removed = 0;
    for (const id of await this.repository.listUploadIds(userId)) {
      if (await this.uploads.remove(userId, id)) removed += 1;
    }
    await this.repository.deleteUserMarkers(userId);
    return removed;
  }
}
