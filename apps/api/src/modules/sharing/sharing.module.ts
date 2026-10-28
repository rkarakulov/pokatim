import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { AppearanceCoreModule } from '../appearance';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { StoryCardImageController } from './story-card-image.controller';
import { StoryCardCache } from './story-card.cache';
import { StoryCardController } from './story-card.controller';
import { StoryCardInputs } from './story-card.inputs';
import { StoryCardProcessor } from './story-card.processor';
import { StoryCardService } from './story-card.service';

/**
 * Карточки для сторис (story-cards, ADR-0018), HTTP: статус своего результата (`AuthGuard`) и PNG по капабилити-токену
 * (IP-лимит). Данные — порты `results` (`RESULTS_FOR_SHARING`), `appearance` (`APP_APPEARANCE`), `profile`
 * (`RIDER_NAMES`) через их `index.ts`; на `sharing` не ссылается никто.
 */
@Module({
  imports: [
    IdentityModule,
    ResultsCoreModule,
    ProfileCoreModule,
    AppearanceCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }),
  ],
  controllers: [StoryCardController, StoryCardImageController],
  providers: [StoryCardService, StoryCardInputs, StoryCardCache, IpRateLimitGuard],
})
export class SharingModule {}

/** Рендер карточек в worker: очередь `story-card` (satori + resvg). */
@Module({
  imports: [
    ResultsCoreModule,
    ProfileCoreModule,
    AppearanceCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }),
  ],
  providers: [StoryCardInputs, StoryCardCache, StoryCardProcessor],
})
export class SharingWorkerModule {}
