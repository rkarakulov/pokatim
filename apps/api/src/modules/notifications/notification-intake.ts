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
import {
  PROFILE_FIELD_RESET,
  ProfileFieldReset,
  RIDER_NAMES,
  type RiderNameDirectory,
} from '../profile';
import {
  ACHIEVEMENT_NOTICES,
  type AchievementNotices,
  ACHIEVEMENTS_GRANT_NOTICED,
  AchievementsGrantNoticed,
} from '../achievements';
import {
  SOCIAL_CONNECTION_ADDED,
  SOCIAL_INVITE_REGISTERED,
  SOCIAL_NOTICES,
  SOCIAL_REACTION_CREATED,
  SOCIAL_RIDE_ASK_DUE,
  SocialConnectionAdded,
  SocialInviteRegistered,
  type SocialNotices,
  SocialReactionCreated,
  SocialRideAskDue,
} from '../social';
import type { NoticeText } from './notification-texts';
import type { NotificationSourceEvent } from './notifications.events';
import { socialNoticeDraft } from './social-notices';

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
  /** в центр без push (`reason: 'in_app'`): райдер сейчас в приложении (achievements-push, P1) */
  inApp?: boolean;
  /**
   * действующее лицо «Своих» (social-p1, ADR-0027 п. 6): повтор в окне `collapse.key` копит лиц в `actors` одного
   * уведомления, а не заменяет его; черновик собирает `socialNoticeDraft`
   */
  actor?: string;
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
 * `RideNotices`, `RouteNotices`, `RaceRegistry`, `TicketNotices`, `SocialNotices`): получатели и поля текста считает
 * сервер, payload — только id и коды (RC-1). Правила получателей — task §7: споры — стороны, райды — участники «Иду»
 * без организатора, «Новый участник» — организатору; райд не в ожидаемом статусе (`cancelled` для отмены, `published`
 * для переноса и участника) — skip. «Свои» (K10, social-p7) — черновики `socialNoticeDraft` по id события (`eventId`:
 * окно схлопывания по времени события).
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
    @Inject(ACHIEVEMENT_NOTICES) private readonly achievements: AchievementNotices,
    @Inject(SOCIAL_NOTICES) private readonly social: SocialNotices,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
  ) {}

  async drafts(
    type: NotificationSourceEvent,
    payload: unknown,
    now: Date,
    eventId: string,
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
        return this.ride(type, payload, eventId);
      case RIDES_REPORTS_RESOLVED:
        return this.reportsResolved(payload);
      case ROUTE_PUBLICATION_DECIDED:
        return this.routePublication(payload);
      case TICKETS_REMINDER_DUE:
        return this.eventReminder(payload, now);
      case PROFILE_FIELD_RESET:
        return this.profileFieldReset(payload);
      case ACHIEVEMENTS_GRANT_NOTICED:
        return this.achievementGranted(payload, now);
      case SOCIAL_REACTION_CREATED:
        return this.socialReaction(payload, eventId);
      case SOCIAL_CONNECTION_ADDED:
        return this.socialAdded(payload, eventId);
      case SOCIAL_INVITE_REGISTERED:
        return this.socialInvite(payload, eventId);
      case SOCIAL_RIDE_ASK_DUE:
        return this.socialRideAsk(payload, eventId);
    }
  }

  /**
   * Новая реакция (K10, social-p7): реакция снята или стёрта к приёму — `gone`. «Спасибо» — получателю, окно — райд
   * (райда нет — `gone`, не опубликован — `state`); «Респект» — владельцу результата или автору маршрута, окно — цель в
   * сутки, название — гонка заявки (`RESULTS_NOTICES.entryRace` + `RACE_REGISTRY`) или маршрут (`ROUTE_NOTICES`).
   */
  private async socialReaction(
    payload: unknown,
    eventId: string,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = SocialReactionCreated.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const reaction = await this.social.reaction(event.data.reactionId);
    if (!reaction) return 'gone';
    const base = { eventId, actor: reaction.actorId, recipients: [reaction.recipientId] };
    if (reaction.kind === 'thanks') {
      if (reaction.targetType !== 'ride_rider') return 'invalid_payload';
      const ride = await this.rides.ride(reaction.targetId);
      if (!ride) return 'gone';
      if (ride.status !== 'published') return 'state';
      const object = { type: 'ride' as const, id: ride.id, title: ride.title };
      return [socialNoticeDraft({ ...base, kind: 'social_thanks', object })];
    }
    if (reaction.targetType === 'race_entry') {
      const raceId = await this.results.entryRace(reaction.targetId);
      const title = raceId && (await this.raceTitle(raceId));
      if (!raceId || !title) return 'gone';
      const object = { type: 'race' as const, id: raceId, title };
      return [socialNoticeDraft({ ...base, kind: 'social_respect', object })];
    }
    if (reaction.targetType === 'route') {
      const route = await this.routes.publication(reaction.targetId);
      if (!route) return 'gone';
      const object = { type: 'route' as const, id: route.id, title: route.title };
      return [socialNoticeDraft({ ...base, kind: 'social_respect', object })];
    }
    return 'invalid_payload';
  }

  /** «Вас добавили в свои» (K10, K11 — отбор в `addManual`): связь убрана к приёму — `state`. */
  private async socialAdded(
    payload: unknown,
    eventId: string,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = SocialConnectionAdded.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const { ownerId, otherId } = event.data;
    if (!(await this.social.connected(ownerId, otherId))) return 'state';
    return [
      socialNoticeDraft({
        kind: 'social_added',
        eventId,
        actor: ownerId,
        recipients: [otherId],
        object: null,
      }),
    ];
  }

  /** «По вашей ссылке зарегистрировались» (K10, K9) — пригласившему, лицо — приглашённый. */
  private socialInvite(payload: unknown, eventId: string): NoticeDraft[] | IntakeSkip {
    const event = SocialInviteRegistered.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    return [
      socialNoticeDraft({
        kind: 'social_invite_registered',
        eventId,
        actor: event.data.inviteeId,
        recipients: [event.data.inviterId],
        object: null,
      }),
    ];
  }

  /** «Как прошёл райд?» (K10, P5): адресаты — из payload (отобраны регламентом); райд не опубликован — `state`. */
  private async socialRideAsk(
    payload: unknown,
    eventId: string,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = SocialRideAskDue.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const ride = await this.rides.ride(event.data.rideId);
    if (!ride) return 'gone';
    if (ride.status !== 'published') return 'state';
    return [
      socialNoticeDraft({
        kind: 'social_ride_ask',
        eventId,
        actor: null,
        recipients: event.data.userIds,
        object: { type: 'ride', id: ride.id, title: ride.title },
      }),
    ];
  }

  /**
   * «Свои идут» (K10, social-p7, RC-P7-2/3): записавшийся — участник с номером входа = `seq` события (нет `seq` или
   * участник вышел — без черновика); непубличный (K3) — без; аудитория — взаимные «свои» записавшегося
   * (`SOCIAL_NOTICES.goingAudience`) без организатора и текущих участников. Окно — райд.
   */
  private async ridersGoing(
    ride: RideNotice,
    seq: number | undefined,
    eventId: string,
  ): Promise<NoticeDraft[]> {
    if (seq === undefined) return [];
    const joiner = ride.participants.find((participant) => participant.seq === seq)?.userId;
    if (!joiner) return [];
    if (!(await this.names.publicRiders([joiner])).has(joiner)) return [];
    const going = new Set([
      ride.organizerUserId,
      joiner,
      ...ride.participants.map((participant) => participant.userId),
    ]);
    const audience = (await this.social.goingAudience(joiner)).filter((id) => !going.has(id));
    if (audience.length === 0) return [];
    return [
      socialNoticeDraft({
        kind: 'social_riders_going',
        eventId,
        actor: joiner,
        recipients: audience,
        object: { type: 'ride', id: ride.id, title: ride.title },
      }),
    ];
  }

  /**
   * Новое достижение или уровень (achievements-push, 5.B) — владельцу выдачи (порт `ACHIEVEMENT_NOTICES`, не payload).
   * Выдача стёрта — `gone`; отозвана, ранг ниже объявленного, факт пропал — `state`. Выдача, найденная сверкой при
   * чтении (`origin: 'read'`), — в центр без push (P1). Схлопывание по выдаче и рангу (N7): одно уведомление на
   * (выдача, уровень) и при двух событиях; новый уровень заменяет непрочитанный прежний.
   */
  private async achievementGranted(
    payload: unknown,
    now: Date,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = AchievementsGrantNoticed.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const notice = await this.achievements.notice(event.data, now);
    if (typeof notice === 'string') return notice;
    const target: NotificationTarget =
      notice.seasonId === null
        ? { type: 'achievement', code: notice.code }
        : { type: 'achievement', code: notice.code, seasonId: notice.seasonId };
    return [
      {
        text: {
          kind: 'achievement_granted',
          code: notice.code,
          level: notice.level,
          objectKind: notice.object.kind,
          objectTitle: notice.object.title,
        },
        target,
        collapse: { key: `achievement:${event.data.grantId}`, seq: event.data.level ?? 1 },
        recipients: [notice.userId],
        inApp: event.data.origin === 'read',
      },
    ];
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
    eventId: string,
  ): Promise<NoticeDraft[] | IntakeSkip> {
    const event = RideEventPayload.safeParse(payload);
    if (!event.success) return 'invalid_payload';
    const ride = await this.rides.ride(event.data.rideId);
    if (!ride) return 'gone';
    const target: NotificationTarget = { type: 'ride', rideId: ride.id };
    if (type === RIDES_RIDE_CANCELLED) {
      if (ride.status !== 'cancelled') return 'state';
      return [this.participantsDraft(ride, 'ride_cancelled', target, event.data.seq)];
    }
    if (ride.status !== 'published') return 'state';
    if (type === RIDES_RIDE_RESCHEDULED) {
      return [
        {
          ...this.participantsDraft(ride, 'ride_rescheduled', target, event.data.seq),
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
      ...(await this.ridersGoing(ride, event.data.seq, eventId)),
    ];
  }

  /**
   * Получатели — участники «Иду», записанные не позже события: номер входа участника ≤ `seq` события (порядок
   * атомарных записей райда). Вошедший после переноса о нём не узнаёт и при позднем приёме или повторе задачи; вошедший
   * до отмены — узнаёт. Событие без `seq` (до поля) — все текущие участники.
   */
  private participantsDraft(
    ride: RideNotice,
    kind: 'ride_cancelled' | 'ride_rescheduled',
    target: NotificationTarget,
    seq: number | undefined,
  ): NoticeDraft {
    const until = seq ?? Number.POSITIVE_INFINITY;
    return {
      text: { kind, ride: ride.title, startsAt: ride.startsAt },
      target,
      recipients: ride.participants
        .filter((participant) => participant.seq <= until)
        .map((participant) => participant.userId),
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
