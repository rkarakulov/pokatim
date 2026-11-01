import { Inject, Injectable, Logger } from '@nestjs/common';

import { RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { StoryCardCache } from './story-card.cache';

/**
 * PNG карточки по капабилити-токену (ride-photo-followups): картинка приглашения с привязкой отдаётся, только пока
 * райд не скрыт и нарисованное фото — текущее (порт `inviteCardLive`, проверка на каждой отдаче); иначе отзывается
 * (`revoke`) и отдача — 404. Без привязки (сторис гонки, достижение, маршрут; приглашения до выката) — как раньше.
 * Привязка не разбирается — отказ. Лог — только id райда.
 */
@Injectable()
export class StoryCardImageService {
  private readonly logger = new Logger(StoryCardImageService.name);

  constructor(
    private readonly cache: StoryCardCache,
    @Inject(RIDES_FOR_SHARING) private readonly rides: RidesForSharing,
  ) {}

  async png(token: string): Promise<Buffer | null> {
    const png = await this.cache.png(token);
    if (!png) return null;
    const binding = await this.cache.binding(token);
    if (binding === null) return png;
    if (binding === 'invalid') return null;
    if (await this.rides.inviteCardLive(binding.rideId, binding.photoId)) return png;
    await this.cache.revoke(token);
    this.logger.log(`story-card revoked ride=${binding.rideId}`);
    return null;
  }
}
