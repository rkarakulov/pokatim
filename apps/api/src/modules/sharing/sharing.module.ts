import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard, PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { AchievementsReadModule } from '../achievements';
import { CalendarCoreModule } from '../calendar';
import { IdentityModule } from '../identity';
import { ProfileCoreModule } from '../profile';
import { RacesCoreModule } from '../races';
import { ResultsCoreModule } from '../results';
import { RidersCoreModule } from '../riders';
import { RidesCoreModule } from '../rides';
import { RoutesCoreModule } from '../routes';
import { SocialCoreModule } from '../social';
import { AchievementCardController } from './achievement-card.controller';
import { AchievementCardInputs } from './achievement-card.inputs';
import { AchievementCardService } from './achievement-card.service';
import { CardRequests } from './card-requests';
import { InviteAddress } from './invite-address';
import { OgCardCache } from './og-card.cache';
import { OgCardController } from './og-card.controller';
import { OgCardInputs } from './og-card.inputs';
import { OgCardQueue } from './og-card.queue';
import { OgCardService } from './og-card.service';
import { OgSync } from './og-sync';
import { OgSchedules, OgSyncProcessor } from './og-sync.processor';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';
import { RideInviteController } from './ride-invite.controller';
import { RideInviteInputs } from './ride-invite.inputs';
import { RideInviteService } from './ride-invite.service';
import { RouteCardController } from './route-card.controller';
import { RouteCardInputs } from './route-card.inputs';
import { RouteCardService } from './route-card.service';
import { StoryCardImageController } from './story-card-image.controller';
import { StoryCardImageService } from './story-card-image.service';
import { StoryCardCache } from './story-card.cache';
import { StoryCardController } from './story-card.controller';
import { StoryCardInputs } from './story-card.inputs';
import { StoryCardProcessor } from './story-card.processor';
import { StoryCardService } from './story-card.service';

/**
 * Карточки (ADR-0018), HTTP: статус сторис своего результата, приглашения кофе-райда, своего достижения и маршрута
 * каталога (`AuthGuard`), PNG по капабилити-токену (IP-лимит), OG-картинки публичных страниц (og-images: версия и PNG без
 * входа) и карта сайта (landing-seo: `GET /v1/sitemap` без входа). Данные — порты
 * `results` (`RESULTS_FOR_SHARING`), `rides` (`RIDES_FOR_SHARING`), `races` (`RACES_FOR_SHARING`), `routes`
 * (`ROUTES_FOR_SHARING`, `ROUTE_GEOMETRY`), `calendar` (`CALENDAR_FOR_SHARING`), `profile` (`RIDER_NAMES`,
 * `RIDER_THEMES`), `achievements` (`ACHIEVEMENTS_FOR_SHARING`), `riders` (`RIDERS_FOR_SHARING` — OG профиля) через их
 * `index.ts`, `social` (`InviteCodes` — адрес приглашения на карточке, P6); на `sharing` не ссылается никто.
 */
@Module({
  imports: [
    IdentityModule,
    ResultsCoreModule,
    RidesCoreModule,
    RacesCoreModule,
    RoutesCoreModule,
    CalendarCoreModule,
    ProfileCoreModule,
    AchievementsReadModule,
    RidersCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }),
    // код приглашения владельца карточки — адрес `/i/<код>` (P6, RC-P6-4); worker адрес берёт из задачи
    SocialCoreModule,
  ],
  controllers: [
    StoryCardController,
    RideInviteController,
    AchievementCardController,
    RouteCardController,
    StoryCardImageController,
    OgCardController,
    SitemapController,
  ],
  providers: [
    CardRequests,
    StoryCardService,
    StoryCardInputs,
    RideInviteService,
    RideInviteInputs,
    AchievementCardService,
    AchievementCardInputs,
    RouteCardService,
    RouteCardInputs,
    StoryCardCache,
    StoryCardImageService,
    OgCardInputs,
    OgCardCache,
    OgCardQueue,
    OgCardService,
    SitemapService,
    IpRateLimitGuard,
    PublicReadGuard,
    InviteAddress,
  ],
})
export class SharingModule {}

/**
 * Рендер карточек в worker: очередь `story-card` (сторис, приглашения, достижения, маршруты каталога, OG-картинки; satori + resvg) и пререндер
 * OG-картинок `og.sync` (очередь `og-sync`, расписание каждую минуту и при старте).
 */
@Module({
  imports: [
    ResultsCoreModule,
    RidesCoreModule,
    RacesCoreModule,
    RoutesCoreModule,
    CalendarCoreModule,
    ProfileCoreModule,
    AchievementsReadModule,
    RidersCoreModule,
    BullModule.registerQueue({ name: QUEUE.storyCard }, { name: QUEUE.ogSync }),
  ],
  providers: [
    StoryCardInputs,
    RideInviteInputs,
    AchievementCardInputs,
    RouteCardInputs,
    StoryCardCache,
    StoryCardProcessor,
    OgCardInputs,
    OgCardCache,
    OgCardQueue,
    OgSync,
    OgSyncProcessor,
    OgSchedules,
  ],
})
export class SharingWorkerModule {}
