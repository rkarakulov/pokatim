import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { IpRateLimitGuard, PublicReadGuard } from '../../public-read.guard';
import { QUEUE } from '../../queues';
import { CalendarCoreModule } from '../calendar';
import { IdentityAccountsModule, IdentityModule } from '../identity';
import { PanelModule } from '../panel';
import { ProfileCoreModule } from '../profile';
import { ResultsCoreModule } from '../results';
import { CalendarRegistrationController } from './calendar-registration.controller';
import { CalendarRegistrationService } from './calendar-registration.service';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { TicketEmailHandler } from './jobs/ticket-email.handler';
import { TicketsEmailProcessor } from './jobs/tickets-email.processor';
import {
  TicketsMaintenanceProcessor,
  TicketsSchedules,
} from './jobs/tickets-maintenance.processor';
import { EventFilesController } from './event-files.controller';
import { MaterialsAdminController } from './materials-admin.controller';
import { MaterialsAdminService } from './materials-admin.service';
import { MaterialsPublicController } from './materials-public.controller';
import { MaterialsRead } from './materials-read';
import { MaterialsRepository } from './materials.repository';
import { PanelEvents } from './panel-events';
import { ParticipantNames } from './participant-names';
import { RaceTicketController } from './race-ticket.controller';
import { RaceTickets } from './race-tickets';
import { TicketErasure } from './ticket-erasure';
import { TicketEvents } from './ticket-events';
import { TicketIssuer } from './ticket-issuer';
import { TicketingAdminController } from './ticketing-admin.controller';
import { TicketingAdminService } from './ticketing-admin.service';
import { TicketingPublicController } from './ticketing-public.controller';
import { TicketingPublicService } from './ticketing-public.service';
import { TicketsController } from './tickets.controller';
import { TicketsReadService } from './tickets-read.service';
import { TicketsRepository } from './tickets.repository';

/**
 * Ядро `tickets` (event-tickets, ADR-0023) для API и worker: репозиторий, факты событий, выпуск, сверка билетов гонок,
 * порт стирания. Зависит от `results` (`RESULTS_FOR_TICKETS`; реэкспорт `RacesCoreModule` — `RACE_REGISTRY`),
 * `calendar` (`CALENDAR_EVENTS`), `profile` (`RIDER_NAMES`), `identity` (`IdentityAccounts`) — только через их
 * `index.ts`. Производители о `tickets` не знают; на `tickets` ссылаются `AppModule`, `WorkerModule` и `account`.
 */
@Module({
  imports: [ResultsCoreModule, CalendarCoreModule, ProfileCoreModule, IdentityAccountsModule],
  providers: [
    TicketsRepository,
    TicketEvents,
    TicketIssuer,
    RaceTickets,
    TicketErasure,
    MaterialsRepository,
    MaterialsRead,
  ],
  exports: [
    TicketsRepository,
    TicketEvents,
    MaterialsRepository,
    MaterialsRead,
    TicketIssuer,
    RaceTickets,
    TicketErasure,
    ResultsCoreModule,
    ProfileCoreModule,
    IdentityAccountsModule,
  ],
})
export class TicketsCoreModule {}

/** HTTP: свои билеты и регистрация (`AuthGuard`), публичная сводка (`PublicReadGuard`), панель (`PanelGuard`). */
@Module({
  imports: [TicketsCoreModule, IdentityModule, PanelModule],
  controllers: [
    RaceTicketController,
    CalendarRegistrationController,
    TicketsController,
    TicketingPublicController,
    TicketingAdminController,
    CheckInController,
    MaterialsAdminController,
    MaterialsPublicController,
    EventFilesController,
  ],
  providers: [
    CalendarRegistrationService,
    TicketsReadService,
    TicketingPublicService,
    TicketingAdminService,
    PanelEvents,
    MaterialsAdminService,
    CheckInService,
    ParticipantNames,
    PublicReadGuard,
    IpRateLimitGuard,
  ],
})
export class TicketsModule {}

/** Задачи `tickets` в worker: письмо «Вы зарегистрированы» и регламент сверки билетов гонок (RC-T12). */
@Module({
  imports: [
    TicketsCoreModule,
    BullModule.registerQueue({ name: QUEUE.ticketsEmail }, { name: QUEUE.ticketsMaintenance }),
  ],
  providers: [
    TicketEmailHandler,
    TicketsEmailProcessor,
    TicketsMaintenanceProcessor,
    TicketsSchedules,
  ],
})
export class TicketsWorkerModule {}
