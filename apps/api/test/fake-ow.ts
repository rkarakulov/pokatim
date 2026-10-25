import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Фейковый Open Wearables 0.9 для тестов (§8 «контрактный тест адаптера»): локальный HTTP-сервер (порт 0) с
 * состоянием — пользователи, подключения, тренировки, ряды — и формой ответов по исходникам OW 0.9
 * (`backend/app/api/routes/v1/{users,oauth,connections,sync_data,events,timeseries}.py`). Ключ — заголовок
 * `X-Open-Wearables-API-Key`; режимы ошибок, ворота на маршрут и журнал вызовов — для проверок.
 */

export const FAKE_OW_API_KEY = 'fake-ow-api-key-0123456789abcdef';

export interface FakeOwWorkout {
  id: string;
  type: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  source: { provider: string; device: string | null };
  distance_meters: number | null;
  avg_heart_rate_bpm: number | null;
  average_watts: number | null;
}

export interface FakeOwSample {
  timestamp: string;
  type: string;
  value: number;
  provider: string;
}

export interface FakeOwCall {
  method: string;
  path: string;
  /** Маршрут без id (`GET /users/{id}/connections`). */
  route: string;
  query: URLSearchParams;
  body: unknown;
}

interface Failure {
  status: number;
  times: number;
  body?: string;
  headers?: Record<string, string>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const routeOf = (method: string, path: string) =>
  `${method} ${path.replace(/^\/api\/v1/, '').replace(UUID, '{id}')}`;

export class FakeOw {
  readonly users = new Map<string, { externalUserId: string | null }>();
  /** userId → provider → статус подключения. */
  readonly connections = new Map<string, Map<string, 'active' | 'expired' | 'revoked'>>();
  readonly workouts = new Map<string, FakeOwWorkout[]>();
  readonly samples = new Map<string, FakeOwSample[]>();
  readonly calls: FakeOwCall[] = [];
  /** `redirect_uri` последней авторизации по `user_id` (то, куда OW вернул бы браузер). */
  readonly redirectUris = new Map<string, string>();
  providers = [
    { provider: 'garmin', name: 'Garmin', is_enabled: true, live_sync_mode: 'webhook' },
    { provider: 'wahoo', name: 'Wahoo', is_enabled: true, live_sync_mode: 'pull' },
    { provider: 'strava', name: 'Strava', is_enabled: true, live_sync_mode: 'pull' },
  ];
  /** `external_user_id` уникален (как в OW 0.9); `false` — модель OW без уникальности (для отрицательного доказательства). */
  uniqueExternalId = true;
  /** Историческая выгрузка поддерживается (иначе 400, как у провайдеров без `rest_pull`). */
  historicalSupported = new Set(['garmin', 'wahoo']);
  private readonly failures = new Map<string, Failure[]>();
  private readonly holds = new Map<string, () => Promise<void>>();
  private server!: Server;
  url = '';

  async start(): Promise<this> {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.users.clear();
    this.connections.clear();
    this.workouts.clear();
    this.samples.clear();
    this.calls.length = 0;
    this.redirectUris.clear();
    this.failures.clear();
    this.holds.clear();
    this.uniqueExternalId = true;
    this.historicalSupported = new Set(['garmin', 'wahoo']);
    this.providers = this.providers.map((row) => ({ ...row, is_enabled: true }));
  }

  /**
   * Следующие `times` запросов маршрута (`GET /users/{id}/connections`) отвечают `status` (и `body`, если задан —
   * записанный ответ OW). Несколько вызовов — очередь ответов по порядку.
   */
  fail(route: string, status: number, times = 1, extra: Omit<Failure, 'status' | 'times'> = {}) {
    this.failures.set(route, [...(this.failures.get(route) ?? []), { status, times, ...extra }]);
  }

  /** Запросы маршрута ждут `wait()` (ворота `gate()` из `test/identity.ts`). */
  hold(route: string, wait: () => Promise<void>) {
    this.holds.set(route, wait);
  }

  callsTo(route: string): FakeOwCall[] {
    return this.calls.filter((call) => call.route === route);
  }

  /** Пользователь прошёл авторизацию у провайдера: OW сам завершил OAuth и связал подключение. */
  authorize(userId: string, provider: string): void {
    const map = this.connections.get(userId) ?? new Map();
    map.set(provider, 'active');
    this.connections.set(userId, map);
  }

  userIdByExternal(externalUserId: string): string | undefined {
    return [...this.users].find(([, user]) => user.externalUserId === externalUserId)?.[0];
  }

  addWorkout(
    userId: string,
    workout: Partial<FakeOwWorkout> & { start_time: string },
  ): FakeOwWorkout {
    const full: FakeOwWorkout = {
      id: randomUUID(),
      type: 'cycling',
      end_time: null,
      duration_seconds: null,
      source: { provider: 'garmin', device: null },
      distance_meters: null,
      avg_heart_rate_bpm: null,
      average_watts: null,
      ...workout,
    };
    this.workouts.set(userId, [...(this.workouts.get(userId) ?? []), full]);
    return full;
  }

  /** Трек: точки `[unix ms, lat, lon, ele]` → три плоских ряда OW (широта, долгота, высота). */
  addTrack(userId: string, provider: string, points: [number, number, number, number | null][]) {
    const rows = this.samples.get(userId) ?? [];
    for (const [time, lat, lon, ele] of points) {
      const timestamp = new Date(time).toISOString();
      rows.push({ timestamp, type: 'latitude', value: lat, provider });
      rows.push({ timestamp, type: 'longitude', value: lon, provider });
      if (ele !== null) rows.push({ timestamp, type: 'elevation', value: ele, provider });
    }
    this.samples.set(userId, rows);
  }

  // --- HTTP ---

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://fake');
    const raw = await readBody(request);
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    const method = request.method ?? 'GET';
    const route = routeOf(method, url.pathname);
    this.calls.push({ method, path: url.pathname, route, query: url.searchParams, body });

    const hold = this.holds.get(route);
    if (hold) await hold();
    const failure = this.failures.get(route)?.find((entry) => entry.times > 0);
    if (failure) {
      failure.times -= 1;
      response.writeHead(failure.status, {
        'content-type': 'application/json',
        ...failure.headers,
      });
      response.end(failure.body ?? JSON.stringify({ detail: 'fake failure' }));
      return;
    }
    const send = (status: number, payload?: unknown) => {
      response.writeHead(
        status,
        payload === undefined ? {} : { 'content-type': 'application/json' },
      );
      response.end(payload === undefined ? undefined : JSON.stringify(payload));
    };

    if (route === 'GET /oauth/providers') return send(200, this.providers);
    if (request.headers['x-open-wearables-api-key'] !== FAKE_OW_API_KEY) {
      return send(401, { detail: 'Invalid or missing API key' });
    }
    const [, , , resource, id, sub, extra] = url.pathname.split('/');

    if (route === 'POST /users') {
      const externalUserId =
        (body as { external_user_id?: string } | undefined)?.external_user_id ?? null;
      if (this.uniqueExternalId && externalUserId && this.userIdByExternal(externalUserId)) {
        return send(400, { detail: 'User entity already exists.' });
      }
      const userId = randomUUID();
      this.users.set(userId, { externalUserId });
      return send(201, {
        id: userId,
        external_user_id: externalUserId,
        created_at: new Date().toISOString(),
      });
    }
    if (route === 'GET /users') {
      const external = url.searchParams.get('external_user_id');
      const items = [...this.users]
        .filter(([, user]) => external === null || user.externalUserId === external)
        .map(([userId, user]) => ({ id: userId, external_user_id: user.externalUserId }));
      return send(200, { items, total: items.length, page: 1, limit: 20 });
    }
    if (resource === 'oauth' && sub === 'authorize') {
      const userId = url.searchParams.get('user_id') ?? '';
      this.redirectUris.set(userId, url.searchParams.get('redirect_uri') ?? '');
      return send(200, {
        authorization_url: `https://connect.provider.test/oauth?state=${randomUUID()}`,
        state: 'state',
      });
    }
    if (resource === 'users' && id && sub === 'connections') {
      const map = this.connections.get(id);
      if (method === 'GET') {
        return send(
          200,
          [...(map ?? [])].map(([provider, status]) => ({
            id: randomUUID(),
            user_id: id,
            provider,
            status,
          })),
        );
      }
      if (method === 'DELETE' && extra) {
        if (!map?.has(extra)) return send(404, { detail: 'connection not found' });
        map.set(extra, 'revoked');
        return send(204);
      }
    }
    if (resource === 'providers') {
      // /api/v1/providers/{provider}/users/{id}/sync[/historical]
      const parts = url.pathname.split('/');
      const provider = parts[4] ?? '';
      if (parts.at(-1) === 'historical') {
        if (!this.historicalSupported.has(provider)) return send(400, { detail: 'unsupported' });
        return send(200, { success: true, provider, method: 'pull_api', task_id: randomUUID() });
      }
      return send(200, { success: true, async: true, task_id: randomUUID() });
    }
    if (resource === 'users' && id && sub === 'events' && extra === 'workouts') {
      return send(200, this.workoutsPage(id, url.searchParams));
    }
    if (resource === 'users' && id && sub === 'timeseries') {
      return send(200, this.timeseriesPage(id, url.searchParams));
    }
    return send(404, { detail: 'Not Found' });
  }

  private workoutsPage(userId: string, query: URLSearchParams) {
    const start = query.get('start_date');
    const end = query.get('end_date');
    if (!start || !end) return { detail: 'start_date and end_date are required' };
    const from = new Date(`${start}T00:00:00Z`).getTime();
    const to = new Date(`${end}T00:00:00Z`).getTime() + 86_400_000;
    const items = (this.workouts.get(userId) ?? [])
      .filter((workout) => {
        const started = new Date(workout.start_time).getTime();
        const ended = workout.end_time ? new Date(workout.end_time).getTime() : started;
        return started >= from && ended < to;
      })
      .sort((a, b) => b.start_time.localeCompare(a.start_time));
    return page(items, query);
  }

  private timeseriesPage(userId: string, query: URLSearchParams) {
    const types = query.getAll('types');
    const from = new Date(query.get('start_time') ?? '').getTime();
    const to = new Date(query.get('end_time') ?? '').getTime();
    const provider = query.get('provider');
    const items = (this.samples.get(userId) ?? [])
      .filter((sample) => {
        const time = new Date(sample.timestamp).getTime();
        return (
          (types.length === 0 || types.includes(sample.type)) &&
          time >= from &&
          time <= to &&
          (provider === null || sample.provider === provider)
        );
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(({ timestamp, type, value }) => ({
        timestamp,
        type,
        value,
        unit: 'degrees',
        zone_offset: null,
      }));
    return page(items, query);
  }
}

/** Курсорная страница формы OW (`data` + `pagination`); курсор — смещение строкой. */
function page<T>(items: T[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('cursor') ?? 0);
  const data = items.slice(offset, offset + limit);
  const hasMore = offset + limit < items.length;
  return {
    data,
    pagination: {
      next_cursor: hasMore ? String(offset + limit) : null,
      previous_cursor: null,
      has_more: hasMore,
      total_count: items.length,
    },
    metadata: { resolution: query.get('resolution'), sample_count: data.length },
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeOw(): Promise<FakeOw> {
  return new FakeOw().start();
}
