import { Inject, Injectable } from '@nestjs/common';
import type { NotificationTarget } from '@pokatim/contracts';

import {
  DISPUTE_NOTICES,
  DisputeDecidedPayload,
  DisputeEventPayload,
  type DisputeNotices,
  DISPUTES_DISPUTE_DECIDED,
  DISPUTES_DISPUTE_FILED,
  DISPUTES_DISPUTE_RESPONDED,
  DISPUTES_DISPUTE_WITHDRAWN,
} from '../disputes';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import {
  RESULTS_ATTEMPT_VERDICT_CHANGED,
  RESULTS_NOTICES,
  RESULTS_PROTOCOL_PUBLISHED,
  RESULTS_RESULT_REVISED,
  ResultsAttemptVerdictChanged,
  type ResultsNotices,
  ResultsProtocolPublished,
  ResultsResultRevised,
} from '../results';
import {
  RIDE_NOTICES,
  RideEventPayload,
  type RideNotice,
  type RideNotices,
  RIDES_PARTICIPANT_JOINED,
  RIDES_REPORTS_RESOLVED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
  RidesReportsResolved,
} from '../rides';
import {
  ROUTE_NOTICES,
  ROUTE_PUBLICATION_DECIDED,
  RoutePublicationDecided,
  type RouteNotices,
} from '../routes';
import {
  TICKET_NOTICES,
  type TicketNotices,
  TICKETS_REMINDER_DUE,
  TicketsReminderDue,
} from '../tickets';
import { PROFILE_FIELD_RESET, ProfileFieldReset } from '../profile';
import type { NoticeText } from './notification-texts';
import type { NotificationSourceEvent } from './notifications.events';

/** Уведомление события для группы получателей: текст ещё не отрисован, цель — из белого списка. */
export interface NoticeDraft {
  text: NoticeText;
  target: NotificationTarget | null;
  /** Цель получателя поверх `target` (PR D: свой билет у каждого, RC-D6). */
  targets?: ReadonlyMap<string, NotificationTarget>;
  /**
   * Повтор по объекту заменяет прежнее уведомление (N7): `key` — объект, `seq` — порядковый номер **события** в объекте
   * (из payload, монотонен внутри объекта): заменяет только более позднее событие, повтор задачи — тот же номер.
   */
  collapse?: { key: string; seq?: number };
  recipients: string[];
}

/** Почему событие не даёт уведомлений: payload не читается, объекта нет, объект не в ожидаемом статусе. */
export type IntakeSkip = 'invalid_payload' | 'gone' | 'state';

const REVISION_KINDS = {
  disqualified: 'protocol_disqualified',
  disqualification_revoked: 'protocol_restored',
  recheck_applied: 'protocol_rechecked',
} as const;

/**
 * Разбор события источника → черновики уведомлений через порты модулей (`ResultsNotices`, `DisputeNotices`,
 * `RideNotices`, `RouteNotices`, `RaceRegistry`, `TicketNotices`): получатели и поля текста считает сервер, payload — только id и коды (RC-1).
 * Правила получателей — task §7: споры — стороны, райды — участники «Иду» без организатора, «Новый участник» —
 * организатору; райд не в ожидаемом статусе (`cancelled` для отмены, `published` для переноса и участника) — skip.
 */
@Injectable()
export class NotificationIntake {
  constructor(
    @Inject(RESULTS_NOTICES) private readonly results: ResultsNotices,
    @Inject(DISPUTE_NOTICES) private readonly disputes: DisputeNotices,
    @Inject(RIDE_NOTICES) private readonly rides: RideNotices,
    @Inject(ROUTE_NOTICES) private readonly routes: RouteNotices,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(TICKET_NOTICES) private readonly tickets: TicketNotices,
  ) {}

  async drafts(
    type: NotificationSourceEvent,
    payload: unknown,
    now: Date,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    switch (type) {
      case RESULTS_ATTEMPT_VERDICT_CHANGED:
        return this.verdict(payload);
      case RESULTS_PROTOCOL_PUBLISHED:
        return this.protocolPublished(payload);
      case RESULTS_RESULT_REVISED:
        return this.resultRevised(payload);
      case DISPUTES_DISPUTE_FILED:
      case DISPUTES_DISPUTE_WITHDRAWN:
      case DISPUTES_DISPUTE_RESPONDED:
      case DISPUTES_DISPUTE_DECIDED:
        return this.dispute(type, payload);
      case RIDES_RIDE_CANCELLED:
      case RIDES_RIDE_RESCHEDULED:
      case RIDES_PARTICIPANT_JOINED:
        return this.ride(type, payload);
      case RIDES_REPORTS_RESOLVED:
        return this.reportsResolved(payload);
      case ROUTE_PUBLICATION_DECIDED:
        return this.routePublication(payload);
      case TICKETS_REMINDER_DUE:
        return this.eventReminder(payload, now);
      case PROFILE_FIELD_RESET:
        return this.profileFieldReset(payload);
    }
  }

  /**
   * Напоминание о событии (PR D, RC-D2): получатели — билеты с меткой отправки (порт `TICKET_NOTICES`); событие не
   * `scheduled` или уже началось — `state`, правило или событие удалены — `gone`. Один черновик, цель — свой билет.
   */
  private async eventReminder(payload: unknown, now: Date): Promise<NoticeDraft[] | IntakeSkip> {
    const event = TicketsReminderDue.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const notice = await this.tickets.reminder(event.data, now);
    if (typeof notice === 'string') return notice;
    return [
      {
        text: {
          kind: 'event_reminder',
          event: notice.event.title,
          startsAt: notice.event.startsAt,
          place: notice.event.place,
          text: notice.text,
        },
        target: null,
        targets: new Map(
          notice.recipients.map(({ userId, code }) => [userId, { type: 'ticket', code }] as const),
        ),
        recipients: notice.recipients.map(({ userId }) => userId),
      },
    ];
  }

  private async raceTitle(raceId: string): Promise<string | null> {
    return (await this.races.get(raceId))?.title ?? null;
  }

  private async verdict(payload: unknown): Promise<NoticeDraft[] | IntakeSkip> {
    const event = ResultsAttemptVerdictChanged.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const attempt = await this.results.attempt(event.data.attemptId);
    const race = attempt && (await this.raceTitle(attempt.raceId));
    if (!attempt || !race) return 'gone';
    return [
      {
        text: {
          kind: event.data.status === 'counted' ? 'result_counted' : 'result_rejected',
          race,
          activityAt: attempt.activityStartedAt,
        },
        target: { type: 'race', raceId: attempt.raceId },
        recipients: [attempt.userId],
      },
    ];
  }

  private async protocolPublished(payload: unknown): Promise<NoticeDraft[] | IntakeSkip> {
    const event = ResultsProtocolPublished.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const race = await this.raceTitle(event.data.raceId);
    if (!race) return 'gone';
    return [
      {
        text: { kind: 'protocol_published', race },
        target: { type: 'race', raceId: event.data.raceId },
        recipients: await this.results.protocolAudience(event.data.raceId),
      },
    ];
  }

  private async resultRevised(payload: unknown): Promise<NoticeDraft[] | IntakeSkip> {
    const event = ResultsResultRevised.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const { raceId, revision, kind, entryId } = event.data;
    const race = await this.raceTitle(raceId);
    if (!race) return 'gone';
    let recipients: string[];
    if (kind === 'recheck_applied') {
      recipients = await this.results.revisionAudience(raceId, revision);
    } else {
      if (entryId === null) return 'invalid_payload';
      const owner = await this.results.entryUser(entryId);
      if (!owner) return 'gone';
      recipients = [owner];
    }
    return [
      {
        text: { kind: REVISION_KINDS[kind], race },
        target: { type: 'race', raceId },
        recipients,
      },
    ];
  }

  private async dispute(
    type:
      | typeof DISPUTES_DISPUTE_FILED
      | typeof DISPUTES_DISPUTE_WITHDRAWN
      | typeof DISPUTES_DISPUTE_RESPONDED
      | typeof DISPUTES_DISPUTE_DECIDED,
    payload: unknown,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const decided =
      type === DISPUTES_DISPUTE_DECIDED ? DisputeDecidedPayload.safeParse(payload) : null;
    const event = decided ?? DisputeEventPayload.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const { disputeId } = event.data;
    const parties = await this.disputes.parties(disputeId);
    const race = parties && (await this.raceTitle(parties.raceId));
    if (!parties || !race) return 'gone';
    const raceTarget: NotificationTarget = { type: 'race', raceId: parties.raceId };
    switch (type) {
      case DISPUTES_DISPUTE_FILED:
        return [
          {
            text: { kind: 'dispute_filed', race },
            target: { type: 'dispute-response', raceId: parties.raceId, disputeId },
            recipients: [parties.targetUserId],
          },
        ];
      case DISPUTES_DISPUTE_WITHDRAWN:
        return [
          {
            text: { kind: 'dispute_withdrawn', race },
            target: raceTarget,
            recipients: [parties.targetUserId],
          },
        ];
      case DISPUTES_DISPUTE_RESPONDED:
        return [
          {
            text: { kind: 'dispute_responded', race },
            target: raceTarget,
            recipients: [parties.complainantUserId],
          },
        ];
      case DISPUTES_DISPUTE_DECIDED: {
        if (!decided?.success) return 'invalid_payload';
        return [
          {
            text: { kind: 'dispute_decided', race, outcome: decided.data.outcome },
            target: raceTarget,
            recipients: [parties.complainantUserId, parties.targetUserId],
          },
        ];
      }
    }
  }

  private async ride(
    type:
      typeof RIDES_RIDE_CANCELLED | typeof RIDES_RIDE_RESCHEDULED | typeof RIDES_PARTICIPANT_JOINED,
    payload: unknown,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = RideEventPayload.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const ride = await this.rides.ride(event.data.rideId);
    if (!ride) return 'gone';
    const target: NotificationTarget = { type: 'ride', rideId: ride.id };
    if (type === RIDES_RIDE_CANCELLED) {
      if (ride.status !== 'cancelled') return 'state';
      return [this.participantsDraft(ride, 'ride_cancelled', target)];
    }
    if (ride.status !== 'published') return 'state';
    if (type === RIDES_RIDE_RESCHEDULED) {
      return [
        {
          ...this.participantsDraft(ride, 'ride_rescheduled', target),
          collapse: { key: `ride:${ride.id}:rescheduled`, seq: event.data.seq },
        },
      ];
    }
    return [
      {
        text: { kind: 'ride_joined', ride: ride.title, goingCount: ride.goingCount },
        target,
        collapse: { key: `ride:${ride.id}:joined`, seq: event.data.seq },
        recipients: [ride.organizerUserId],
      },
    ];
  }

  private participantsDraft(
    ride: RideNotice,
    kind: 'ride_cancelled' | 'ride_rescheduled',
    target: NotificationTarget,
  ): NoticeDraft {
    return {
      text: { kind, ride: ride.title, startsAt: ride.startsAt },
      target,
      recipients: ride.participantUserIds,
    };
  }

  private async reportsResolved(payload: unknown): Promise<NoticeDraft[] | IntakeSkip> {
    const event = RidesReportsResolved.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const ride = await this.rides.ride(event.data.rideId);
    if (!ride) return 'gone';
    const reporters = await this.rides.resolvedReporters(ride.id, new Date(event.data.resolvedAt));
    return [
      {
        text: { kind: 'ride_report_resolved', ride: ride.title },
        // скрытый модерацией райд авторам не виден — без перехода («Не найдено» не показываем)
        target: ride.status === 'hidden' ? null : { type: 'ride', rideId: ride.id },
        recipients: reporters,
      },
    ];
  }

  /**
   * Решение по заявке маршрута — автору. Решение сменилось к приёму (новая подача, скрытие, отзыв, другое решение —
   * статус или `decidedAt` не совпали) — `state`: о прежнем решении не сообщаем. Новое решение по маршруту заменяет
   * прежнее уведомление (N7).
   */
  private async routePublication(payload: unknown): Promise<NoticeDraft[] | IntakeSkip> {
    const event = RoutePublicationDecided.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const route = await this.routes.publication(event.data.routeId);
    if (!route) return 'gone';
    const { decision, decidedAt } = event.data;
    if (route.status !== decision || route.decidedAt?.getTime() !== Date.parse(decidedAt)) {
      return 'state';
    }
    let text: NoticeText;
    if (decision === 'approved') {
      text = { kind: 'route_published', route: route.title };
    } else {
      if (!route.rejectionReason) return 'state';
      text = { kind: 'route_rejected', route: route.title, reason: route.rejectionReason };
    }
    return [
      {
        text,
        target: { type: 'my-route', routeId: route.id },
        // решения одного маршрута разделены новой подачей — момент решения монотонен
        collapse: { key: `route:${route.id}:publication`, seq: Date.parse(decidedAt) },
        recipients: [route.ownerUserId],
      },
    ];
  }

  /**
   * Сброс поля профиля модератором (profile-moderation-followups) — самому райдеру. Порта нет (RC-F3): payload
   * самодостаточен (получатель, поле, время, срок запрета); живость получателя проверяет запись (`liveUserIds`). Новый
   * сброс того же поля заменяет прежнее уведомление (N7, момент сброса монотонен).
   */
  private profileFieldReset(payload: unknown): NoticeDraft[] | IntakeSkip {
    const event = ProfileFieldReset.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const { userId, field, seq, avatarBlockedUntil } = event.data;
    const text: NoticeText =
      field === 'avatar'
        ? {
            kind: 'profile_avatar_reset',
            blockedUntil: avatarBlockedUntil ? new Date(avatarBlockedUntil) : null,
          }
        : { kind: field === 'name' ? 'profile_name_reset' : 'profile_club_reset' };
    return [
      {
        text,
        target: { type: 'profile-edit' },
        // ревизия сбросов профиля (ревью pass 2): позже записанный сброс заменяет прежний независимо от `resetAt`
        collapse: { key: `profile:${userId}:${field}`, seq },
        recipients: [userId],
      },
    ];
  }
}
