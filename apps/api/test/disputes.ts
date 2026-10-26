import {
  minskWallTimeToUtc,
  MyDispute,
  MyRaceDisputes,
  MyRaceEntry,
  PanelDispute,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DisputeDoc, disputesCollections } from '../src/modules/disputes/disputes.collection';
import { DAY, type Harness } from './harness';
import { call } from './identity';
import { panelCall, panelSession } from './panel';
import {
  corridorRace,
  enterRace,
  rider,
  seedBest,
  signIn,
  travelTo,
  UPLOAD_CLOSES,
} from './results';

/** Коллекции модуля `disputes` тестовой БД. */
export const disputesDb = (h: Harness) => disputesCollections(h.db);

/**
 * Спор напрямую в БД (подготовка тестов гейтов `results`/`races`; подачу проверяет `disputes`). По умолчанию —
 * открытый, `filedAt` — «сейчас» стенда.
 */
export async function seedDispute(
  h: Harness,
  input: Pick<DisputeDoc, 'raceId' | 'targetEntryId'> & Partial<DisputeDoc>,
): Promise<DisputeDoc> {
  const now = h.clock.now();
  const doc: DisputeDoc = {
    _id: uuidv7(),
    groupKey: 'overall',
    complainantUserId: uuidv7(),
    complainantEntryId: uuidv7(),
    targetUserId: uuidv7(),
    category: 'other',
    description: null,
    status: 'open',
    response: null,
    decision: null,
    filedAt: now,
    closedAt: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  await disputesDb(h).disputes.insertOne(doc);
  return doc;
}

/** Закрыть спор напрямую в БД (подготовка: «после решения или отзыва»). */
export async function closeSeededDispute(h: Harness, id: string): Promise<void> {
  await disputesDb(h).disputes.updateOne(
    { _id: id },
    { $set: { status: 'withdrawn', closedAt: h.clock.now() } },
  );
}

// --- подача и решение через API (race-results-06) ---

/** Плановая публикация протокола гонки споров: отсечка D-44 (−24 ч) — после срока загрузки с запасом. */
export const DISPUTE_PROTOCOL_PLANNED = minskWallTimeToUtc('2026-10-30T23:59');
/** Отсечка приёма споров гонки `disputeRace`: плановая − 24 ч. */
export const DISPUTE_FILING_CLOSES = new Date(new Date(DISPUTE_PROTOCOL_PLANNED).getTime() - DAY);

export const disputesUrl = (raceId: string) => `/v1/races/${raceId}/disputes`;
export const ADMIN_DISPUTES = '/v1/admin/disputes';

/** Подача спора. */
export const fileDispute = (
  h: Harness,
  auth: Record<string, string>,
  raceId: string,
  body: Record<string, unknown>,
) => call(h, 'POST', disputesUrl(raceId), body, auth);

/** Отзыв и ответ. */
export const withdrawDispute = (h: Harness, auth: Record<string, string>, id: string) =>
  call(h, 'POST', `/v1/disputes/${id}/withdraw`, {}, auth);
export const respondDispute = (
  h: Harness,
  auth: Record<string, string>,
  id: string,
  text: string,
) => call(h, 'POST', `/v1/disputes/${id}/response`, { text }, auth);

/** Мои споры в гонке (тест знает, что 200). */
export async function myDisputes(
  h: Harness,
  auth: Record<string, string>,
  raceId: string,
): Promise<MyRaceDisputes> {
  const res = await call(h, 'GET', disputesUrl(raceId), undefined, auth);
  if (res.status !== 200) throw new Error(`мои споры: ${res.status} ${JSON.stringify(res.body)}`);
  return MyRaceDisputes.parse(res.body);
}

/** Решение по спору в панели. */
export const decideDispute = (
  h: Harness,
  token: string,
  id: string,
  body: Record<string, unknown> = { outcome: 'upheld', template: 'rules_violation' },
) => panelCall(h, token, 'POST', `${ADMIN_DISPUTES}/${id}/decision`, body);

/** Разбор спора в панели (тест знает, что 200). */
export async function panelDispute(h: Harness, token: string, id: string): Promise<PanelDispute> {
  const res = await panelCall(h, token, 'GET', `${ADMIN_DISPUTES}/${id}`);
  if (res.status !== 200) throw new Error(`разбор: ${res.status} ${JSON.stringify(res.body)}`);
  return PanelDispute.parse(res.body);
}

/** id поданного спора (тест знает, что 201). */
export function filedId(res: { status: number; body: unknown }): string {
  if (res.status !== 201) throw new Error(`подача: ${res.status} ${JSON.stringify(res.body)}`);
  return MyDispute.parse(res.body).id;
}

/** Код и причина отказа. */
export const refusal = (res: { status: number; body: unknown }) => {
  const body = res.body as { code?: string; details?: { reason?: string } };
  return [res.status, body.code, body.details?.reason];
};

/**
 * Гонка для споров: коридор, плановая публикация протокола 30.10 23:59 Минска (отсечка D-44 — 29.10 23:59), заявки
 * райдеров (по порядку e-mail) с лучшими временами (`null` — без результата); часы — после срока загрузки (публикация
 * возможна, приём споров открыт), access райдеров и сессия админа панели — свежие.
 */
export async function disputeRace(h: Harness, times: readonly (number | null)[]) {
  const race = await corridorRace(h, { protocolPlannedAt: DISPUTE_PROTOCOL_PLANNED });
  const entered = [];
  for (const [index, elapsed] of times.entries()) {
    const r = await rider(h, `rider${index}@example.com`);
    const entry = MyRaceEntry.parse((await enterRace(h, r.auth, race.raceId)).body).entry!;
    if (elapsed !== null) {
      await seedBest(h, entry.id, elapsed, new Date(`2026-10-25T0${index}:00:00Z`));
    }
    entered.push({ ...r, entryId: entry.id });
  }
  travelTo(h, UPLOAD_CLOSES);
  const riders = [];
  for (const r of entered) riders.push({ ...r, auth: await signIn(h, r.email) });
  const token = await panelSession(h, 'admin@example.by');
  return { ...race, riders, token };
}

/** Перевести часы и обновить access райдеров и сессию админа панели. */
export async function travelFresh<T extends { email: string }>(
  h: Harness,
  at: Date,
  riders: readonly T[],
): Promise<{ riders: (T & { auth: Record<string, string> })[]; token: string }> {
  travelTo(h, at);
  const fresh = [];
  for (const r of riders) fresh.push({ ...r, auth: await signIn(h, r.email) });
  return { riders: fresh, token: await panelSession(h, 'admin@example.by') };
}
