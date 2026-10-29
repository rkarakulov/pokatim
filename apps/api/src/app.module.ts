import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  API_ERROR_MESSAGES,
  ApiExceptionFilter,
  ClockModule,
  ConfigModule,
  QueueModule,
  RedisModule,
} from '@rkarakulov/api-kit/core';
import { MongoModule, MongoOutboxModule } from '@rkarakulov/api-kit/mongo';

import { env } from './config/env';
import { PROJECT_ERROR_MESSAGES } from './error-messages';
import { AccountModule } from './modules/account';
import { AchievementsModule } from './modules/achievements';
import { CalendarModule } from './modules/calendar';
import { AppearanceModule } from './modules/appearance';
import { DevicesModule } from './modules/devices';
import { DisputesCoreModule, DisputesModule } from './modules/disputes';
import { HealthModule } from './modules/health';
import { IdentityModule } from './modules/identity';
import { NotificationsModule } from './modules/notifications';
import { OverviewModule } from './modules/overview';
import { PanelModule } from './modules/panel';
import { ProfileModule } from './modules/profile';
import { RacesModule } from './modules/races';
import { RidesModule } from './modules/rides';
import { ResultsModule } from './modules/results';
import { RidersModule } from './modules/riders';
import { RoutesModule } from './modules/routes';
import { SharingModule } from './modules/sharing';
import { RouteRidesModule } from './modules/route-rides';
import { StandingsModule } from './modules/standings';
import { TicketsModule } from './modules/tickets';
import { TracksModule } from './modules/tracks';

@Module({
  imports: [
    ConfigModule.forRoot(env),
    ClockModule,
    // replica set проверяется на старте: транзакции и outbox без него не работают
    MongoModule.forRoot(),
    RedisModule,
    MongoOutboxModule,
    QueueModule,
    HealthModule,
    TracksModule,
    IdentityModule,
    ProfileModule,
    PanelModule,
    RoutesModule,
    // заезд по маршруту вне гонки (route-rides-01)
    RouteRidesModule,
    RacesModule,
    ResultsModule,
    // гейты споров для `results` и `races` (@Global, RC-1)
    DisputesCoreModule,
    DisputesModule,
    // рейтинг сезона (race-results-08)
    StandingsModule,
    SharingModule,
    // профиль райдера: статистика и публичный профиль (rider-profile, модуль-композиция)
    RidersModule,
    // достижения райдера: выдача сверкой при чтении (achievements, ADR-0020)
    AchievementsModule,
    CalendarModule,
    // билеты на мероприятия: регистрация, билет, check-in (event-tickets, ADR-0021)
    TicketsModule,
    OverviewModule,
    AppearanceModule,
    RidesModule,
    DevicesModule,
    // удаление аккаунта (оркестратор, ADR-0015)
    AccountModule,
    // центр уведомлений (ADR-0017)
    NotificationsModule,
  ],
  // единый формат ошибок ApiError для всех модулей; тексты кодов проекта — рядом с фильтром
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: API_ERROR_MESSAGES, useValue: PROJECT_ERROR_MESSAGES },
  ],
})
export class AppModule {}
