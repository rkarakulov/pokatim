import { Inject, Injectable } from '@nestjs/common';
import {
  type CancelRaceRequest,
  type CorridorInput,
  type DiscardRaceRequest,
  type PanelRace,
  type PanelRacePage,
  type PanelRaceQuery,
  type PublishRaceRequest,
  type RaceCancelReason,
  type RaceInput,
  type RaceStatus,
  type UpdateRaceRequest,
  UtcMinute,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelAudit, PanelDirectory, type PanelPrincipal } from '../panel';
import { ROUTE_CATALOG, type RouteCatalog } from '../routes';
import type { RaceCorridor, RaceDoc, SeasonDoc } from './races.collection';
import {
  changedRaceFields,
  corridorChangeAllowed,
  corridorDistanceKm,
  type FieldIssue,
  ownScope,
  protocolPublished,
  raceEditable,
  racePhase,
  type RaceValues,
  raceVisible,
  validateCorridorRoute,
  validateRaceRules,
  windowPassed,
} from './races.policy';
import { RacesRepository } from './races.repository';
import { fieldError, fieldsError, staleVersion } from './schedule-errors';

const invalidState = () => domainError('RACE_INVALID_STATE', 409);

/** Коридор запроса после проверки маршрута; `placeholder` — длина неизвестна (маршрут не готов или поле закрыто). */
interface ResolvedCorridor {
  corridor: RaceCorridor | null;
  placeholder: boolean;
  issue?: FieldIssue;
}

/** Ошибки дистанции из-за заглушки длины маршрута не показываются — причина уже в ошибке коридора. */
const withoutPlaceholderDistance = (issues: FieldIssue[], resolved: ResolvedCorridor) =>
  resolved.placeholder ? issues.filter((issue) => issue.path !== 'distanceKm') : issues;
const notFound = () => domainError('NOT_FOUND', 404);

/** Сотрудник может менять гонку: `races.manage_any` или `races.manage` и она своя. */
function canManage(principal: PanelPrincipal, race: RaceDoc): boolean {
  if (principal.permissions.includes('races.manage_any')) return true;
  return principal.permissions.includes('races.manage') && race.ownerUserId === principal.userId;
}

/**
 * Дистанция гонки: с коридором — из запроса (если есть; несовпадение с вычисленной — `FIELD_LOCKED` в правилах), иначе
 * вычисленная из длины маршрута; без коридора — из запроса или прежняя (снятие коридора оставляет последнюю).
 */
function distanceFor(
  corridor: RaceCorridor | null,
  requested: number | undefined,
  fallback: number,
): number {
  if (requested !== undefined) return requested;
  return corridor ? corridorDistanceKm(corridor) : fallback;
}

const toValues = (input: RaceInput, corridor: RaceCorridor | null): RaceValues => ({
  title: input.title,
  bikeClass: input.bikeClass,
  surfaces: input.surfaces,
  // без коридора и без дистанции создание отклонено раньше (`REQUIRED`)
  distanceKm: distanceFor(corridor, input.distanceKm, 0),
  description: input.description,
  windowStartsAt: new Date(input.windowStartsAt),
  windowEndsAt: new Date(input.windowEndsAt),
  protocolPlannedAt: new Date(input.protocolPlannedAt),
  corridor,
});

/** Изменённые значения запроса поверх документа; коридор уже разрешён (`resolveCorridor`). */
function mergeValues(
  current: RaceDoc,
  input: UpdateRaceRequest,
  corridor: RaceCorridor | null,
): RaceValues {
  const date = (value: string | undefined, fallback: Date) =>
    value === undefined ? fallback : new Date(value);
  return {
    title: input.title ?? current.title,
    bikeClass: input.bikeClass ?? current.bikeClass,
    surfaces: input.surfaces ?? current.surfaces,
    distanceKm: distanceFor(corridor, input.distanceKm, current.distanceKm),
    description: input.description === undefined ? current.description : input.description,
    windowStartsAt: date(input.windowStartsAt, current.windowStartsAt),
    windowEndsAt: date(input.windowEndsAt, current.windowEndsAt),
    protocolPlannedAt: date(input.protocolPlannedAt, current.protocolPlannedAt),
    corridor,
  };
}

/**
 * Гонки панели (ADR-0010): черновик → опубликована → отменена; удаление черновика. Владение (R8) и `editable` (R10)
 * — здесь, по правам сессии. Публикация и смена конца окна опубликованной — под `lockSchedule` (R2), изменения —
 * по ожидаемой `version` (R3). Каждое изменение — одна запись журнала в транзакции действия.
 */
@Injectable()
export class RacesService {
  constructor(
    private readonly repository: RacesRepository,
    private readonly audit: PanelAudit,
    private readonly directory: PanelDirectory,
    private readonly transactions: MongoTransactions,
    @Inject(ROUTE_CATALOG) private readonly routes: RouteCatalog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(principal: PanelPrincipal, query: PanelRaceQuery): Promise<PanelRacePage> {
    const after = query.cursor ? decodeCursor(query.cursor, UtcMinute) : null;
    const docs = await this.repository.listPanel(
      {
        status: query.status,
        seasonId: query.seasonId,
        bikeClass: query.bikeClass,
        ownerUserId: ownScope(principal) || query.mine ? principal.userId : undefined,
      },
      after ? { k: new Date(after.k), id: after.id } : null,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.present(principal, page),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.windowStartsAt.toISOString(), last._id)
          : null,
    };
  }

  async get(principal: PanelPrincipal, id: string): Promise<PanelRace> {
    const race = await this.repository.findRace(id);
    if (!race || !this.visible(principal, race)) throw notFound();
    return this.presentOne(principal, race);
  }

  /**
   * Черновик: правила формы, владелец — автор; сезон не хранится (R9). Коридор — готовый маршрут (проверка в той же
   * транзакции); без коридора дистанция обязательна (`REQUIRED`).
   */
  async create(principal: PanelPrincipal, input: RaceInput): Promise<PanelRace> {
    const race = await this.transactions.run(async (tx) => {
      const now = this.clock.now();
      // все ошибки формы одним ответом: обязательная дистанция, маршрут, правила окна
      const issues: FieldIssue[] = [];
      if (!input.corridor && input.distanceKm === undefined) {
        issues.push({ path: 'distanceKm', code: 'REQUIRED' });
      }
      const resolved = await this.resolveCorridor(input.corridor ?? null, null, tx, true);
      if (resolved.issue) issues.push(resolved.issue);
      const values = toValues(input, resolved.corridor);
      issues.push(...withoutPlaceholderDistance(validateRaceRules(values, null, now), resolved));
      if (issues.length > 0) throw fieldsError(issues);
      const doc: RaceDoc = {
        _id: uuidv7(),
        ownerUserId: principal.userId,
        status: 'draft',
        ...values,
        seasonId: null,
        cancelReason: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        cancelledAt: null,
        lockedAt: null,
        protocolPublishedAt: null,
        version: 0,
      };
      await this.repository.insertRace(tx, doc);
      await this.audit.append(tx, {
        action: 'race.created',
        actor: { kind: 'user', userId: principal.userId },
        subject: { kind: 'race', id: doc._id, label: doc.title },
      });
      return doc;
    });
    return this.presentOne(principal, race);
  }

  /**
   * Коридор запроса → коридор документа: `null` — без коридора; тот же маршрут и допуск — без изменений; иначе
   * маршрут обязан быть готовым (`RouteCatalog.findReady` в транзакции действия; `ready` терминален и маршрут не
   * удаляется — замок не нужен). Не готов, не найден, чужой необработанный — `ROUTE_NOT_READY` на `corridor.routeId`;
   * ворота линейного маршрута пересекаются при этом допуске — `CORRIDOR_GATES_OVERLAP` (race-results-03).
   */
  private async resolveCorridor(
    input: CorridorInput | null,
    current: RaceCorridor | null,
    tx: DbSession,
    /** `false` — коридор менять нельзя (фаза): маршрут не проверяется, ответ — `FIELD_LOCKED` правил. */
    editable: boolean,
  ): Promise<ResolvedCorridor> {
    if (input === null) return { corridor: null, placeholder: false };
    const sameRoute = current !== null && current.routeId === input.routeId;
    if (sameRoute && (current.widthM === input.widthM || !editable)) {
      const corridor = {
        routeId: input.routeId,
        widthM: input.widthM,
        distanceM: current.distanceM,
      };
      return { corridor, placeholder: false };
    }
    // заглушка длины: правила проверят остальные поля, ошибки дистанции из-за неё не показываются
    const placeholder = {
      corridor: {
        routeId: input.routeId,
        widthM: input.widthM,
        distanceM: current?.distanceM ?? 0,
      },
      placeholder: true,
    };
    if (!editable) return placeholder;
    const route = await this.routes.findReady(input.routeId, tx);
    if (!route) {
      return { ...placeholder, issue: { path: 'corridor.routeId', code: 'ROUTE_NOT_READY' } };
    }
    const corridor = { routeId: route.id, widthM: input.widthM, distanceM: route.distanceM };
    const gates = validateCorridorRoute(route, input.widthM);
    return gates
      ? { corridor, placeholder: false, issue: gates }
      : { corridor, placeholder: false };
  }

  /**
   * Правка (V-11): отменённая — 409 `RACE_INVALID_STATE`; опубликованная — по фазе (`FIELD_LOCKED`, «только позже»);
   * смена конца окна опубликованной — под `lockSchedule`, конец обязан остаться в сезоне (`OUTSIDE_SEASON`).
   */
  async update(
    principal: PanelPrincipal,
    id: string,
    input: UpdateRaceRequest,
  ): Promise<PanelRace> {
    const race = await this.transactions.run(async (tx) => {
      // снимок без записи — решить, нужен ли замок расписания; затем замок (первая запись транзакции)
      const snapshot = await this.manageable(principal, id, tx);
      if (snapshot.status === 'cancelled') throw invalidState();
      if (snapshot.version !== input.version) throw staleVersion();
      const now = this.clock.now();
      const current = snapshot.corridor ?? null;
      const resolved: ResolvedCorridor =
        input.corridor === undefined
          ? { corridor: current, placeholder: false }
          : await this.resolveCorridor(
              input.corridor,
              current,
              tx,
              corridorChangeAllowed(snapshot, now),
            );
      const next = mergeValues(snapshot, input, resolved.corridor);
      const changed = changedRaceFields(snapshot, next);
      if (changed.length === 0 && !resolved.issue) return snapshot;
      const issues = [
        ...(resolved.issue ? [resolved.issue] : []),
        ...withoutPlaceholderDistance(validateRaceRules(next, snapshot, now), resolved),
      ];
      if (issues.length > 0) throw fieldsError(issues);

      let seasonId = snapshot.seasonId;
      if (snapshot.status === 'published' && changed.includes('windowEndsAt')) {
        await this.repository.lockSchedule(tx);
        seasonId = (await this.seasonFor(next.windowEndsAt, tx))._id;
      }
      const updated = await this.repository.updateRace(tx, id, input.version, [snapshot.status], {
        ...next,
        seasonId,
        updatedAt: now,
      });
      if (!updated) throw staleVersion();
      await this.audit.append(tx, {
        action: 'race.updated',
        actor: { kind: 'user', userId: principal.userId },
        subject: { kind: 'race', id, label: updated.title },
        details: { changedFields: changed },
      });
      return updated;
    });
    return this.presentOne(principal, race);
  }

  /** Публикация (Q6, R2): замок → черновик и версия → окно не прошло → правила → сезон по концу окна. */
  async publish(
    principal: PanelPrincipal,
    id: string,
    input: PublishRaceRequest,
  ): Promise<PanelRace> {
    const race = await this.transactions.run(async (tx) => {
      await this.repository.lockSchedule(tx);
      const current = await this.manageable(principal, id, tx);
      if (current.status !== 'draft') throw invalidState();
      if (current.version !== input.version) throw staleVersion();
      const now = this.clock.now();
      if (windowPassed(current, now)) throw fieldError('windowEndsAt', 'WINDOW_IN_PAST');
      const issues = validateRaceRules(current, null, now);
      if (issues.length > 0) throw fieldsError(issues);
      const season = await this.seasonFor(current.windowEndsAt, tx);
      return this.transition(tx, principal, current, input.version, 'draft', {
        action: 'race.published',
        set: { status: 'published', seasonId: season._id, publishedAt: now, updatedAt: now },
      });
    });
    return this.presentOne(principal, race);
  }

  /** Отмена опубликованной — только шаблонная причина (D-20), необратимо; после публикации протокола — нет (D-19). */
  async cancel(
    principal: PanelPrincipal,
    id: string,
    input: CancelRaceRequest,
  ): Promise<PanelRace> {
    const race = await this.transactions.run(async (tx) => {
      const current = await this.manageable(principal, id, tx);
      if (current.status !== 'published' || protocolPublished(current)) throw invalidState();
      if (current.version !== input.version) throw staleVersion();
      const now = this.clock.now();
      return this.transition(tx, principal, current, input.version, 'published', {
        action: 'race.cancelled',
        set: { status: 'cancelled', cancelReason: input.reason, cancelledAt: now, updatedAt: now },
        details: { cancelReason: input.reason },
        guard: { protocolPublishedAt: null },
      });
    });
    return this.presentOne(principal, race);
  }

  /** Удаление черновика (опубликованная не удаляется). */
  async discard(principal: PanelPrincipal, id: string, input: DiscardRaceRequest): Promise<void> {
    await this.transactions.run(async (tx) => {
      const current = await this.manageable(principal, id, tx);
      if (current.status !== 'draft') throw invalidState();
      if (current.version !== input.version) throw staleVersion();
      const deleted = await this.repository.deleteDraft(tx, id, input.version);
      if (!deleted) throw staleVersion();
      await this.audit.append(tx, {
        action: 'race.discarded',
        actor: { kind: 'user', userId: principal.userId },
        subject: { kind: 'race', id, label: deleted.title },
      });
    });
  }

  private async transition(
    tx: DbSession,
    principal: PanelPrincipal,
    current: RaceDoc,
    version: number,
    from: RaceStatus,
    change: {
      action: 'race.published' | 'race.cancelled';
      set: Partial<RaceDoc>;
      details?: { cancelReason: RaceCancelReason };
      guard?: { protocolPublishedAt?: null };
    },
  ): Promise<RaceDoc> {
    const updated = await this.repository.updateRace(
      tx,
      current._id,
      version,
      [from],
      change.set,
      change.guard,
    );
    if (!updated) throw staleVersion();
    await this.audit.append(tx, {
      action: change.action,
      actor: { kind: 'user', userId: principal.userId },
      subject: { kind: 'race', id: current._id, label: updated.title },
      details: change.details ?? null,
    });
    return updated;
  }

  /** Гонка, которую сотрудник может менять: невидимая или чужая без `races.manage_any` — 404 (R8). */
  private async manageable(principal: PanelPrincipal, id: string, tx: DbSession): Promise<RaceDoc> {
    const race = await this.repository.findRace(id, tx);
    if (!race || !canManage(principal, race)) throw notFound();
    return race;
  }

  private visible(principal: PanelPrincipal, race: RaceDoc): boolean {
    return raceVisible(principal, race);
  }

  /** Сезон, в который попадает конец окна (`startsAt ≤ end < endsBefore`); нет — `OUTSIDE_SEASON`. */
  private async seasonFor(windowEndsAt: Date, tx: DbSession): Promise<SeasonDoc> {
    const season = await this.repository.seasonCovering(windowEndsAt, tx);
    if (!season) throw fieldError('windowEndsAt', 'OUTSIDE_SEASON');
    return season;
  }

  private async presentOne(principal: PanelPrincipal, race: RaceDoc): Promise<PanelRace> {
    const [item] = await this.present(principal, [race]);
    if (!item) throw notFound();
    return item;
  }

  /** Ответ панели: имя организатора (без e-mail), сезон (у черновика — предпросмотр), фаза и `editable`. */
  private async present(
    principal: PanelPrincipal,
    races: readonly RaceDoc[],
  ): Promise<PanelRace[]> {
    if (races.length === 0) return [];
    const routeIds = races.flatMap((race) => (race.corridor ? [race.corridor.routeId] : []));
    const [names, seasons, routes] = await Promise.all([
      this.directory.displayNames(races.map((race) => race.ownerUserId)),
      this.repository.listSeasons(),
      this.routes.summaries(routeIds),
    ]);
    const now = this.clock.now();
    const byId = new Map(seasons.map((season) => [season._id, season]));
    const covering = (at: Date) =>
      seasons.find((season) => season.startsAt <= at && at < season.endsBefore);
    return races.map((race) => {
      const fixed = race.seasonId ? byId.get(race.seasonId) : undefined;
      const preview = race.status === 'draft' ? covering(race.windowEndsAt) : undefined;
      const season = fixed ?? preview;
      return {
        id: race._id,
        status: race.status,
        phase: racePhase(race, now),
        title: race.title,
        bikeClass: race.bikeClass,
        surfaces: race.surfaces,
        distanceKm: race.distanceKm,
        description: race.description,
        windowStartsAt: race.windowStartsAt.toISOString(),
        windowEndsAt: race.windowEndsAt.toISOString(),
        protocolPlannedAt: race.protocolPlannedAt.toISOString(),
        season: season ? { id: season._id, name: season.name, preview: !fixed } : null,
        owner: { userId: race.ownerUserId, displayName: names.get(race.ownerUserId) ?? '' },
        cancelReason: race.cancelReason,
        corridor: race.corridor
          ? {
              route: {
                id: race.corridor.routeId,
                title: routes.get(race.corridor.routeId)?.title ?? '',
              },
              widthM: race.corridor.widthM,
              distanceM: race.corridor.distanceM,
            }
          : null,
        createdAt: race.createdAt.toISOString(),
        updatedAt: race.updatedAt.toISOString(),
        publishedAt: race.publishedAt?.toISOString() ?? null,
        cancelledAt: race.cancelledAt?.toISOString() ?? null,
        version: race.version,
        editable: raceEditable(race, now, {
          canManage: canManage(principal, race),
          seasonFound: preview !== undefined,
        }),
      };
    });
  }
}
