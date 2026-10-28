import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { AppearanceCoreModule } from '../appearance';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { RidesCoreModule } from '../rides';
import { CardRequests } from './card-requests';
import { RideInviteController } from './ride-invite.controller';
import { RideInviteInputs } from './ride-invite.inputs';
import { RideInviteService } from './ride-invite.service';
import { StoryCardImageController } from './story-card-image.controller';
import { StoryCardCache } from './story-card.cache';
import { StoryCardController } from './story-card.controller';
import { StoryCardInputs } from './story-card.inputs';
import { StoryCardProcessor } from './story-card.processor';
import { StoryCardService } from './story-card.service';

/**
 * Карточки (ADR-0018), HTTP: статус сторис своего результата и приглашения кофе-райда (`AuthGuard`) и PNG по
 * капабилити-токену (IP-лимит). Данные — порты `results` (`RESULTS_FOR_SHARING`), `rides` (`RIDES_FOR_SHARING`),
 * `appearance` (`APP_APPEARANCE`), `profile` (`RIDER_NAMES`) через их `index.ts`; на `sharing` не ссылается никто.
 */
@Module({
  imports: [
    IdentityModule,
    ResultsCoreModule,
    RidesCoreModule,
    ProfileCoreModule,
    AppearanceCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }),
  ],
  controllers: [StoryCardController, RideInviteController, StoryCardImageController],
  providers: [
    CardRequests,
    StoryCardService,
    StoryCardInputs,
    RideInviteService,
    RideInviteInputs,
    StoryCardCache,
    IpRateLimitGuard,
  ],
})
export class SharingModule {}

/** Рендер карточек в worker: очередь `story-card` (сторис и приглашения; satori + resvg). */
@Module({
  imports: [
    ResultsCoreModule,
    RidesCoreModule,
    ProfileCoreModule,
    AppearanceCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }),
  ],
  providers: [StoryCardInputs, RideInviteInputs, StoryCardCache, StoryCardProcessor],
})
export class SharingWorkerModule {}
