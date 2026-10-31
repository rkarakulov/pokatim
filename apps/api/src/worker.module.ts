import { Module } from '@nestjs/common';
import {
  ClockModule,
  ConfigModule,
  MailModule,
  QueueModule,
  RedisModule,
} from '@rkarakulov/api-kit/core';
import {
  MongoModule,
  MongoOutboxModule,
  MongoOutboxPublisherModule,
} from '@rkarakulov/api-kit/mongo';

import { env } from './config/env';
import { workerOutboxRoutes } from './outbox-routes';
import { AccountWorkerModule } from './modules/account';
import { AchievementsWorkerModule } from './modules/achievements';
import { IdentityWorkerModule } from './modules/identity';
import { DevicesWorkerModule } from './modules/devices';
import { DisputesCoreModule, DisputesWorkerModule } from './modules/disputes';
import { NotificationsWorkerModule } from './modules/notifications';
import { PanelWorkerModule } from './modules/panel';
import { ResultsWorkerModule } from './modules/results';
import { RouteRidesWorkerModule } from './modules/route-rides';
import { RoutesWorkerModule } from './modules/routes';
import { SharingWorkerModule } from './modules/sharing';
import { SocialWorkerModule } from './modules/social';
import { StandingsWorkerModule } from './modules/standings';
import { TicketsWorkerModule } from './modules/tickets';
import { TracksWorkerModule } from './modules/tracks';

/** Отдельный процесс: задачи очередей (письма, тяжёлая обработка) не блокируют API. */
@Module({
  imports: [
    ConfigModule.forRoot(env),
    ClockModule,
    MongoModule.forRoot(),
    QueueModule,
    // лимиты и кеш квоты хранилища, замки синхронизации устройств
    RedisModule,
    MailModule,
    MongoOutboxModule,
    // composition root: маршруты подписчиков outbox — `mergeOutboxRoutes` (fan-out), `src/outbox-routes.ts`
    MongoOutboxPublisherModule.forRoot({ routes: workerOutboxRoutes }),
    TracksWorkerModule,
    IdentityWorkerModule,
    DevicesWorkerModule,
    RoutesWorkerModule,
    ResultsWorkerModule,
    // гейт D-39 для приёма попыток (@Global, RC-1)
    DisputesCoreModule,
    // ряды пульса и мощности для разбора спора (race-results-06b)
    DisputesWorkerModule,
    // фоновая очистка удалённого аккаунта (account-deletion, ADR-0015)
    AccountWorkerModule,
    // приём событий для центра уведомлений (ADR-0017)
    NotificationsWorkerModule,
    // регламент рейтинга сезона (race-results-08, DV-1: сверка отпечатков, без событий)
    StandingsWorkerModule,
    // рендер карточек для сторис (story-cards, ADR-0018)
    SharingWorkerModule,
    // сверка заезда по маршруту вне гонки (route-rides-01)
    RouteRidesWorkerModule,
    // письмо «Вы зарегистрированы» и сверка билетов гонок (event-tickets)
    TicketsWorkerModule,
    // письма панели: приглашение в команду и письма о роли (panel-invitations, ADR-0026)
    PanelWorkerModule,
    // серверная сверка достижений: регламент по курсорам портов владельцев, push без открытия приложения (achievements-push)
    AchievementsWorkerModule,
    // «Свои» (ADR-0027): якорь процессоров social-intake и social-maintenance (P5, P7)
    SocialWorkerModule,
  ],
})
export class WorkerModule {}
