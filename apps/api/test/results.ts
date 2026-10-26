import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MyRaceEntry, PanelRaceResults, SignInResponse } from '@pokatim/contracts';
import type { CorridorGeometry } from '@pokatim/tracks';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { AttemptCheckProcessor } from '../src/modules/results/attempt-check.processor';
import { resultsCollections } from '../src/modules/results/results.collection';
import { resultsOutboxRoutes } from '../src/modules/results/results.events';
import { ResultsIntakeProcessor } from '../src/modules/results/results-intake.processor';
import { ResultsRepository } from '../src/modules/results/results.repository';
import type { Harness } from './harness';
import {
  bearer,
  call,
  outboxEvents,
  signUpSession,
  userIdByEmail,
  validRegistration,
} from './identity';
import { panelCall, panelSession } from './panel';
import { createSeason, publishedRace, RACES, staff } from './races';
import { routesDb } from './routes';
import { parsedUpload, processUpload, tracks, uploadTrack } from './tracks';

/** Коллекции модуля `results` тестовой БД. */
export const resultsDb = (h: Harness) => resultsCollections(h.db);

/** Репозиторий `results` API стенда (spy в тестах гонок записи других модулей). */
export const resultsRepository = (h: Harness) => h.app.get(ResultsRepository, { strict: false });

const CORRIDOR_FIXTURES = fileURLToPath(
  new URL('../../../packages/tracks/src/__fixtures__/corridor', import.meta.url),
);

interface ExpectedCase {
  corridor: CorridorGeometry;
  expected: {
    verdict: 'counted' | 'rejected';
    reasons: string[];
    elapsedSec?: number;
    offCorridorShare?: number;
    maxExcursionM?: number;
  };
}

/** Эталоны движка (`corridor-expected.json`): коридор и ожидаемый вердикт фикстуры. */
export const corridorExpected = JSON.parse(
  readFileSync(join(CORRIDOR_FIXTURES, 'corridor-expected.json'), 'utf8'),
) as { engineVersion: number; fixtures: Record<string, ExpectedCase> };

/** Линейный коридор эталона (`clean.gpx`, ±50 м, 8 км). */
export const CORRIDOR = corridorExpected.fixtures['clean.gpx']!.corridor;

/**
 * Фикстура коридора со сдвигом времени: первая точка — `startAt`, интервалы × `scale` (медленнее — больше время).
 * Позволяет проехать эталонный трек в окне гонки стенда (окно эталона — июнь 2026). `power` — мощность в точках
 * (активность станет основной группы дублей), `type` — тип трека GPX.
 */
export function rideGpx(
  name: string,
  startAt: Date,
  options: { scale?: number; power?: boolean; type?: string } = {},
): Buffer {
  const { scale = 1, power = false, type } = options;
  let text = readFileSync(join(CORRIDOR_FIXTURES, name), 'utf8');
  const times = [
    ...text.matchAll(/<trkpt[^>]*>\s*(?:<ele>[^<]*<\/ele>\s*)?<time>([^<]+)<\/time>/g),
  ];
  const first = new Date(times[0]![1]!).getTime();
  const shift = (iso: string) =>
    new Date(startAt.getTime() + (new Date(iso).getTime() - first) * scale).toISOString();
  text = text.replace(/<time>([^<]+)<\/time>/g, (_, iso: string) => `<time>${shift(iso)}</time>`);
  if (power) {
    text = text.replaceAll('</trkpt>', '<extensions><power>200</power></extensions></trkpt>');
  }
  if (type) text = text.replace(/<type>[^<]*<\/type>/, `<type>${type}</type>`);
  return Buffer.from(text);
}

/** Готовый маршрут с линией эталона — напрямую в БД (подготовка; разбор маршрутов проверяет `routes`). */
export async function corridorRoute(
  h: Harness,
  ownerUserId: string,
  geometry: Omit<CorridorGeometry, 'widthM'> = CORRIDOR,
): Promise<string> {
  const id = uuidv7();
  const now = h.clock.now();
  const start = geometry.line[0]!;
  const finish = geometry.line.at(-1)!;
  await routesDb(h).routes.insertOne({
    _id: id,
    origin: 'platform',
    ownerUserId,
    title: 'Эталонный коридор',
    status: 'ready',
    failure: null,
    attempts: 1,
    sha256: id,
    sizeBytes: 1,
    distanceM: geometry.distanceM,
    elevationGainM: null,
    isLoop: geometry.isLoop,
    start: { type: 'Point', coordinates: start },
    finish: { type: 'Point', coordinates: finish },
    createdAt: now,
    updatedAt: now,
  });
  await routesDb(h).geometries.insertOne({
    _id: id,
    line: { type: 'LineString', coordinates: geometry.line },
    matchLine: geometry.line,
    sourcePointCount: geometry.line.length,
  });
  return id;
}

/** Окно гонки стенда (Минск): 24.10 00:00 — 26.10 23:59 (UTC 23.10 21:00 — 26.10 20:59). */
export const WINDOW = {
  startsAt: new Date('2026-10-23T21:00:00Z'),
  closesAt: new Date('2026-10-26T21:00:00Z'),
};

/** Админ, сезон, маршрут эталона и опубликованная гонка с коридором ±50 м. */
export async function corridorRace(h: Harness, overrides: Record<string, unknown> = {}) {
  const admin = await staff(h, 'admin@example.by', 'admin');
  await createSeason(h, admin.token);
  const routeId = await corridorRoute(h, admin.userId);
  const race = await publishedRace(h, admin.token, {
    distanceKm: undefined,
    corridor: { routeId, widthM: CORRIDOR.widthM },
    ...overrides,
  });
  return { admin, routeId, raceId: race.id, version: race.version };
}

/** Перевести часы стенда к моменту (только вперёд). */
export function travelTo(h: Harness, at: Date): void {
  const ms = at.getTime() - h.clock.now().getTime();
  if (ms < 0) throw new Error('часы стенда идут только вперёд');
  h.clock.advance(ms);
}

/** Райдер: регистрация и сессия; после перевода часов — `signIn` заново (access истекает). */
export async function rider(h: Harness, email = 'rider@example.com') {
  const session = await signUpSession(h, email);
  return { email, auth: bearer(session.accessToken), userId: await userIdByEmail(h, email) };
}

let signIns = 0;
/** Новый access по паролю (каждый вход — свой адрес: лимиты входа не мешают). */
export async function signIn(h: Harness, email: string): Promise<Record<string, string>> {
  signIns += 1;
  const res = await call(
    h,
    'POST',
    '/v1/auth/session/sign-in',
    { email, password: validRegistration().password },
    { 'x-forwarded-for': `203.0.113.${signIns % 250}` },
  );
  const body = SignInResponse.parse(res.body);
  if (body.state !== 'signedIn') throw new Error(`вход: ${res.status}`);
  return bearer(body.session.accessToken);
}

export const entryUrl = (raceId: string) => `/v1/races/${raceId}/entry`;

export const enterRace = (h: Harness, auth: Record<string, string>, raceId: string) =>
  call(h, 'POST', entryUrl(raceId), {}, auth);
export const withdraw = (h: Harness, auth: Record<string, string>, raceId: string) =>
  call(h, 'POST', `${entryUrl(raceId)}/withdraw`, {}, auth);
export const addAttempt = (
  h: Harness,
  auth: Record<string, string>,
  raceId: string,
  body: Record<string, unknown>,
) => call(h, 'POST', `/v1/races/${raceId}/attempts`, body, auth);

export async function myEntry(
  h: Harness,
  auth: Record<string, string>,
  raceId: string,
): Promise<MyRaceEntry> {
  const res = await call(h, 'GET', entryUrl(raceId), undefined, auth);
  if (res.status !== 200) throw new Error(`моё участие: ${res.status} ${JSON.stringify(res.body)}`);
  return MyRaceEntry.parse(res.body);
}

/** Загрузить файл заезда и разобрать (worker); id загрузки и активности. */
export async function uploadRide(h: Harness, auth: Record<string, string>, bytes: Buffer) {
  const res = await uploadTrack(h, auth, bytes);
  const upload = parsedUpload(res);
  const outcome = await processUpload(h, upload.id);
  const activity = await tracks(h).activities.findOne({ uploadId: upload.id });
  return { uploadId: upload.id, outcome, activityId: activity?._id ?? null };
}

const job = (name: string, outboxEventId: string, attemptsMade = 0) =>
  ({
    name,
    data: { outboxEventId },
    attemptsMade,
    opts: { attempts: 5 },
  }) as unknown as Job<OutboxJobData>;

/**
 * Обработчик событий outbox `results` в тесте (как публикатор + worker): приём попыток и проверки по порядку
 * записи, каждое событие — один раз; повторяет, пока появляются новые.
 */
export function resultsWorker(h: Harness) {
  const handled = new Set<string>();
  const types = Object.keys(resultsOutboxRoutes);
  return {
    handled,
    /** Только приём попыток (без проверок): события `tracks` и «заявка создана». */
    async intake(): Promise<number> {
      return this.run(false);
    },
    /** Приём попыток и проверки — до тишины. */
    async drain(): Promise<number> {
      return this.run(true);
    },
    async run(checks: boolean): Promise<number> {
      let processed = 0;
      for (;;) {
        const events = (await outboxEvents(h)).filter(
          (event) =>
            types.includes(event.type) &&
            !handled.has(event._id) &&
            (checks || event.type !== 'results.attempt-check-requested'),
        );
        if (events.length === 0) return processed;
        for (const event of events) {
          handled.add(event._id);
          processed += 1;
          if (event.type === 'results.attempt-check-requested') {
            await h.worker.get(AttemptCheckProcessor).process(job(event.type, event._id));
          } else {
            await h.worker.get(ResultsIntakeProcessor).process(job(event.type, event._id));
          }
        }
      }
    },
  };
}

// --- протокол гонки (race-results-05) ---

/** Срок загрузки заездов гонки стенда (конец окна + 24 ч, A5): публикация — не раньше. */
export const UPLOAD_CLOSES = new Date(WINDOW.closesAt.getTime() + 24 * 3_600_000);

/** Путь панели гонки: `/v1/admin/races/:raceId{path}`. */
export const raceAdminUrl = (raceId: string, path = '') => `${RACES}/${raceId}${path}`;

/** Причина действия панели (3–500). */
export const REASON = { reason: 'Проверка протокола' };

/** Действие панели над протоколом. */
export const protocolAction = (
  h: Harness,
  token: string,
  raceId: string,
  path: string,
  body: Record<string, unknown> = REASON,
) => panelCall(h, token, 'POST', raceAdminUrl(raceId, path), body);

/** Сводка результатов панели (тест знает, что 200). */
export async function panelResults(h: Harness, token: string, raceId: string) {
  const res = await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/results'));
  if (res.status !== 200) throw new Error(`сводка: ${res.status} ${JSON.stringify(res.body)}`);
  return PanelRaceResults.parse(res.body);
}

/** Лучший результат заявки — напрямую в БД (подготовка мест протокола; проверки — в results-check). */
export async function seedBest(h: Harness, entryId: string, elapsedSec: number, startedAt: Date) {
  await resultsDb(h).entries.updateOne(
    { _id: entryId },
    {
      $set: {
        best: {
          attemptId: uuidv7(),
          elapsedSec,
          startedAt,
          finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
        },
        summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
      },
    },
  );
}

/**
 * Гонка с заявками райдеров (по порядку e-mail) и лучшими временами (`null` — без результата); часы — после срока
 * загрузки, сессия админа панели — свежая.
 */
export async function protocolRace(h: Harness, times: readonly (number | null)[]) {
  const race = await corridorRace(h);
  const riders = [];
  for (const [index, elapsed] of times.entries()) {
    const r = await rider(h, `rider${index}@example.com`);
    const entry = MyRaceEntry.parse((await enterRace(h, r.auth, race.raceId)).body).entry!;
    if (elapsed !== null) {
      await seedBest(h, entry.id, elapsed, new Date(`2026-10-25T0${index}:00:00Z`));
    }
    riders.push({ ...r, entryId: entry.id });
  }
  travelTo(h, UPLOAD_CLOSES);
  const token = await panelSession(h, 'admin@example.by');
  return { ...race, riders, token };
}
