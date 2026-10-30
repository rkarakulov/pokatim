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
import { accountOutboxRoutes, AccountWorkerModule } from './modules/account';
import { identityOutboxRoutes, IdentityWorkerModule } from './modules/identity';
import { devicesOutboxRoutes, DevicesWorkerModule } from './modules/devices';
import { DisputesCoreModule, DisputesWorkerModule } from './modules/disputes';
import { notificationsOutboxRoutes, NotificationsWorkerModule } from './modules/notifications';
import { panelOutboxRoutes, PanelWorkerModule } from './modules/panel';
import { resultsOutboxRoutes, ResultsWorkerModule } from './modules/results';
import { routeRidesOutboxRoutes, RouteRidesWorkerModule } from './modules/route-rides';
import { routesOutboxRoutes, RoutesWorkerModule } from './modules/routes';
import { SharingWorkerModule } from './modules/sharing';
import { StandingsWorkerModule } from './modules/standings';
import { ticketsOutboxRoutes, TicketsWorkerModule } from './modules/tickets';
import { tracksOutboxRoutes, TracksWorkerModule } from './modules/tracks';

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
    // composition root: какие события outbox в какие очереди (`{ ...<модуль>OutboxRoutes }`)
    MongoOutboxPublisherModule.forRoot({
      routes: {
        ...identityOutboxRoutes,
        ...tracksOutboxRoutes,
        ...devicesOutboxRoutes,
        ...routesOutboxRoutes,
        ...resultsOutboxRoutes,
        ...routeRidesOutboxRoutes,
        ...accountOutboxRoutes,
        ...ticketsOutboxRoutes,
        ...panelOutboxRoutes,
        // подписчик чужих типов (results, disputes, rides, routes) — ADR-0017
        ...notificationsOutboxRoutes,
      },
    }),
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
  ],
})
export class WorkerModule {}
