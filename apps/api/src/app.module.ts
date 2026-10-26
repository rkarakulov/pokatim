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
import { CalendarModule } from './modules/calendar';
import { DevicesModule } from './modules/devices';
import { DisputesCoreModule } from './modules/disputes';
import { HealthModule } from './modules/health';
import { IdentityModule } from './modules/identity';
import { PanelModule } from './modules/panel';
import { ProfileModule } from './modules/profile';
import { RacesModule } from './modules/races';
import { RidesModule } from './modules/rides';
import { ResultsModule } from './modules/results';
import { RoutesModule } from './modules/routes';
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
    RacesModule,
    ResultsModule,
    // гейты споров для `results` и `races` (@Global, RC-1)
    DisputesCoreModule,
    CalendarModule,
    RidesModule,
    DevicesModule,
  ],
  // единый формат ошибок ApiError для всех модулей; тексты кодов проекта — рядом с фильтром
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: API_ERROR_MESSAGES, useValue: PROJECT_ERROR_MESSAGES },
  ],
})
export class AppModule {}
