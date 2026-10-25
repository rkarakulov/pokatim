import { createHmac } from 'node:crypto';

import { getQueueToken } from '@nestjs/bullmq';
import { Session } from '@pokatim/contracts';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';

import { devicesCollections } from '../src/modules/devices/devices.collection';
import { DevicesSyncProcessor } from '../src/modules/devices/devices-sync.processor';
import { DevicesSyncService } from '../src/modules/devices/devices-sync.service';
import { TrackProcessingProcessor } from '../src/modules/tracks/track-processing.processor';
import { QUEUE } from '../src/queues';
import { FAKE_OW_API_KEY, type FakeOw } from './fake-ow';
import { createHarness, type Harness } from './harness';
import { bearer, call, outboxEvents, signUpSession, userIdByEmail } from './identity';

export const PUBLIC_API_ORIGIN = 'https://api.pokatim.test';
export const WEB_RETURN_URL = 'https://app.pokatim.test/devices/return';
export const NATIVE_RETURN_URL = 'pokatim://devices/return';
/** Секрет Svix тестов (`whsec_` + base64 32 байт). */
export const WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;

/** Стенд с включёнными устройствами и фейковым OW; `OW_WEBHOOK_SECRET: ''` — без секрета вебхука (push выключен). */
export function createDevicesHarness(
  ow: FakeOw,
  overrides: Parameters<typeof createHarness>[0] = {},
): Promise<Harness> {
  const { OW_WEBHOOK_SECRET = WEBHOOK_SECRET, ...rest } = overrides;
  return createHarness({
    DEVICES_ENABLED: 'true',
    OW_API_URL: ow.url,
    OW_API_KEY: FAKE_OW_API_KEY,
    ...(OW_WEBHOOK_SECRET ? { OW_WEBHOOK_SECRET } : {}),
    PUBLIC_API_ORIGIN,
    DEVICE_RETURN_URLS: `${WEB_RETURN_URL},${NATIVE_RETURN_URL}`,
    OW_SHARED_INSTANCE: 'true',
    ...rest,
  });
}

export const devices = (h: Harness) => devicesCollections(h.db);

export interface Rider {
  userId: string;
  accessToken: string;
  auth: Record<string, string>;
}

export async function rider(h: Harness, email = 'rider@example.com'): Promise<Rider> {
  const session = Session.parse(await signUpSession(h, email));
  return {
    userId: await userIdByEmail(h, email),
    accessToken: session.accessToken,
    auth: bearer(session.accessToken),
  };
}

export const listDevices = (h: Harness, who: Rider) =>
  call(h, 'GET', '/v1/devices', undefined, who.auth);

export const connect = (h: Harness, who: Rider, provider = 'garmin', returnUrl = WEB_RETURN_URL) =>
  call(h, 'POST', `/v1/devices/${provider}/connect`, { returnUrl }, who.auth);

export const complete = (h: Harness, who: Rider, ticket: string, provider = 'garmin') =>
  call(h, 'POST', `/v1/devices/${provider}/complete`, { ticket }, who.auth);

export const syncNow = (h: Harness, who: Rider, provider = 'garmin') =>
  call(h, 'POST', `/v1/devices/${provider}/sync`, undefined, who.auth);

export const disconnect = (h: Harness, who: Rider, provider = 'garmin', deleteActivities = false) =>
  call(h, 'POST', `/v1/devices/${provider}/disconnect`, { deleteActivities }, who.auth);

/** id пользователя OW по пользователю pokatim (запись `device_accounts`). */
export async function aggUserIdOf(h: Harness, userId: string): Promise<string> {
  const account = await devices(h).accounts.findOne({ _id: userId });
  if (!account) throw new Error('no device account');
  return account.aggUserId;
}

/** Тикет из `redirect_uri`, который pokatim передал OW при авторизации. */
export function ticketFromOw(ow: FakeOw, aggUserId: string): string {
  const redirect = ow.redirectUris.get(aggUserId);
  const ticket = redirect ? new URL(redirect).searchParams.get('t') : null;
  if (!ticket) throw new Error('no ticket in redirect_uri');
  return ticket;
}

export interface Connected extends Rider {
  aggUserId: string;
  connectionId: string;
}

/** connect → авторизация у провайдера (в OW) → complete: активное подключение. */
export async function connectActive(
  h: Harness,
  ow: FakeOw,
  who: Rider,
  provider = 'garmin',
): Promise<Connected> {
  const started = await connect(h, who, provider);
  if (started.status !== 200) throw new Error(`connect: ${started.status}`);
  const aggUserId = await aggUserIdOf(h, who.userId);
  ow.authorize(aggUserId, provider);
  const done = await complete(h, who, ticketFromOw(ow, aggUserId), provider);
  if (done.status !== 200) throw new Error(`complete: ${done.status}`);
  const connection = await devices(h).connections.findOne({
    userId: who.userId,
    provider: provider as 'garmin',
  });
  if (!connection) throw new Error('no connection');
  return { ...who, aggUserId, connectionId: connection._id };
}

/** Задача BullMQ для процессора (как её отдал бы worker). */
export const jobOf = (name: string, data: unknown, attemptsMade = 0) =>
  ({ name, data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job;

/** Обработать события outbox типа `type` процессором `devices-sync` (по порядку); результаты задач. */
export async function runOutbox(h: Harness, type: string, attemptsMade = 0): Promise<string[]> {
  const processor = h.worker.get(DevicesSyncProcessor);
  const results: string[] = [];
  for (const event of await outboxEvents(h)) {
    if (event.type !== type) continue;
    results.push(await processor.process(jobOf(type, { outboxEventId: event._id }, attemptsMade)));
  }
  return results;
}

export const syncService = (h: Harness) => h.worker.get(DevicesSyncService);
export const outboxReader = (h: Harness) => h.worker.get(MongoOutboxReader);

/** Очередь `devices-sync` графа API (туда API ставит pull). */
export const apiSyncQueue = (h: Harness): Queue =>
  h.app.get(getQueueToken(QUEUE.devicesSync), { strict: false });

/** Задачи pull в очереди, ждущие выполнения. */
export async function pendingPulls(h: Harness) {
  const jobs = await apiSyncQueue(h).getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs.filter((job) => job.name === 'pull');
}

/** Заголовки Svix для тела (подпись — секретом тестов, метка — по часам стенда). */
export function svixHeaders(body: string, now: Date, secret = WEBHOOK_SECRET, id = 'msg_test') {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

/** Разбор загрузки реальным `track-processing` worker (тот же путь, что у ручной загрузки). */
export const processUpload = (h: Harness, uploadId: string) =>
  h.worker.get(TrackProcessingProcessor).processUpload(uploadId);

/** Документы `tracks` (чтение по имени коллекции — тест не пишет в них). */
export const trackUploads = (h: Harness) =>
  h.db.collection<{
    _id: string;
    userId: string;
    source: string;
    sourceRef: string | null;
    status: string;
  }>('track_uploads');
export const activities = (h: Harness) =>
  h.db.collection<{
    _id: string;
    uploadId: string;
    source: string;
    sport: string;
    distanceM: number;
  }>('activities');

/** Трек заезда: `count` точек раз в секунду на север от Минска (~5 м/с), высота — каждая вторая. */
export function rideTrack(start: Date, count = 600): [number, number, number, number | null][] {
  return Array.from({ length: count }, (_, i) => [
    start.getTime() + i * 1000,
    53.9 + i * 0.000045,
    27.56,
    i % 2 === 0 ? 220 + i / 100 : null,
  ]);
}
