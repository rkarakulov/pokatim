import { minskWallTimeToUtc, type PanelRole } from '@pokatim/contracts';

import { racesCollections } from '../src/modules/races/races.collection';
import type { Harness } from './harness';
import { memberUser, panelCall, panelSession } from './panel';

/** Коллекции модуля `races` тестовой БД. */
export const racesDb = (h: Harness) => racesCollections(h.db);

export const SEASONS = '/v1/admin/seasons';
export const RACES = '/v1/admin/races';

/** Сотрудник с ролью и сессией панели: id и токен cookie. */
export async function staff(h: Harness, email: string, role: PanelRole) {
  const userId = await memberUser(h, email, role);
  return { userId, token: await panelSession(h, email) };
}

/** Тело сезона (стенд: «сейчас» — 2026-10-22, сезон 2026 текущий). */
export const seasonBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  ...overrides,
});

/** Создать сезон через API (тест знает, что успешно); id. */
export async function createSeason(
  h: Harness,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await panelCall(h, token, 'POST', SEASONS, seasonBody(overrides));
  if (res.status !== 201) throw new Error(`сезон: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

/** Тело гонки с окном по настенному времени Минска (`YYYY-MM-DDTHH:mm`). */
export function raceBody(
  overrides: Record<string, unknown> = {},
  wall: { start?: string; end?: string; protocol?: string } = {},
) {
  return {
    title: 'Минское кольцо',
    bikeClass: 'road',
    surfaces: ['asphalt'],
    distanceKm: 42.5,
    description: null,
    windowStartsAt: minskWallTimeToUtc(wall.start ?? '2026-10-24T00:00'),
    windowEndsAt: minskWallTimeToUtc(wall.end ?? '2026-10-26T23:59'),
    protocolPlannedAt: minskWallTimeToUtc(wall.protocol ?? '2026-10-28T23:59'),
    ...overrides,
  };
}

export interface RaceRef {
  id: string;
  version: number;
}

/** Создать черновик через API; id и версия. */
export async function createRace(
  h: Harness,
  token: string,
  overrides: Record<string, unknown> = {},
  wall: Parameters<typeof raceBody>[1] = {},
): Promise<RaceRef> {
  const res = await panelCall(h, token, 'POST', RACES, raceBody(overrides, wall));
  if (res.status !== 201) throw new Error(`гонка: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as RaceRef;
}

/** Создать и опубликовать гонку; итоговая версия. */
export async function publishedRace(
  h: Harness,
  token: string,
  overrides: Record<string, unknown> = {},
  wall: Parameters<typeof raceBody>[1] = {},
): Promise<RaceRef> {
  const race = await createRace(h, token, overrides, wall);
  const res = await panelCall(h, token, 'POST', `${RACES}/${race.id}/publish`, {
    version: race.version,
  });
  if (res.status !== 200) throw new Error(`публикация: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as RaceRef;
}

/** Коды полей ответа 400. */
export const fieldCodes = (body: unknown) =>
  ((body as { details?: { fields?: { path: string; code: string }[] } }).details?.fields ?? []).map(
    (field) => `${field.path}:${field.code}`,
  );
