import { MyRoute, MyRoutePage, RiderRouteModerationPage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, signUpSession, userIdByEmail } from '../../../test/identity';
import { panel } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  moderationCall,
  MY_ROUTES,
  publicationDoc,
  riderCall,
  routesDb,
  seedRiderRoute,
  submissionBody,
  submitPublication,
  withdrawPublication,
} from '../../../test/routes';
import { RoutesRepository } from './routes.repository';

/**
 * Публикация своего маршрута автором (routes-06, AC1, AC3, AC4; N2, N5, N6): заявка, статус в «Моих», отзыв и снятие,
 * повторная подача отклонённого, лимиты U8, заморозка названия, изоляция чужих и маршрутов команды.
 */
let h: Harness;
let moderator: { userId: string; token: string };
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  moderator = await staff(h, 'moderator@example.by', 'moderator');
});
afterAll(async () => {
  await h.close();
});

const MY_ROUTE_KEYS = Object.keys(MyRoute.shape).sort();
const PUBLICATION_KEYS = [
  'city',
  'decidedAt',
  'rejection',
  'showAuthorName',
  'status',
  'submittedAt',
  'surfaces',
];
const HIDDEN =
  /ownerUserId|"origin"|catalog|"version"|submissionCount|openReportCount|lastReportAt|reportRevision|approvedAt|hiddenAt/;

async function rider(email = 'rider@example.com') {
  const session = await signUpSession(h, email);
  return { token: session.accessToken, userId: await userIdByEmail(h, email) };
}

const myRoute = async (token: string, id: string) =>
  MyRoute.parse((await riderCall(h, token, 'GET', `${MY_ROUTES}/${id}`)).body);
const pendingQueue = async () =>
  RiderRouteModerationPage.parse(
    (await moderationCall(h, moderator.token, 'GET', '')).body,
  ).items.map((item) => item.id);
const catalogIds = async () =>
  ((await call(h, 'GET', '/v1/routes')).body as { items: { id: string }[] }).items.map(
    (item) => item.id,
  );
const versionOf = async (id: string) =>
  (await routesDb(h).routes.findOne({ _id: id }))?.publication?.version ?? -1;
const reject = async (id: string, comment: string | null = 'Старт у дома') =>
  moderationCall(h, moderator.token, 'POST', `/${id}/reject`, {
    version: await versionOf(id),
    reason: 'dangerous',
    ...(comment === null ? {} : { comment }),
  });
const approve = async (id: string) =>
  moderationCall(h, moderator.token, 'POST', `/${id}/approve`, {
    version: await versionOf(id),
    city: 'minsk',
    surfaces: ['asphalt'],
  });

describe('подача и статус в «Моих» (AC1)', () => {
  it('готовый → 200 MyRoute: pending, canPublish false; ключи — контрактные, no-store; в очереди панели; в каталоге — нет; журнала нет', async () => {
    const me = await rider();
    const id = await seedRiderRoute(h, me.userId);
    const before = await myRoute(me.token, id);
    expect(before).toMatchObject({ publication: null, canPublish: true });

    const res = await submitPublication(
      h,
      me.token,
      id,
      submissionBody({ city: 'brest', surfaces: ['gravel', 'asphalt'], showAuthorName: true }),
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body as object).sort()).toEqual(MY_ROUTE_KEYS);
    expect(Object.keys((res.body as { publication: object }).publication).sort()).toEqual(
      PUBLICATION_KEYS,
    );
    expect(JSON.stringify(res.body)).not.toMatch(HIDDEN);
    expect(MyRoute.parse(res.body)).toMatchObject({
      id,
      canPublish: false,
      publication: {
        status: 'pending',
        city: 'brest',
        surfaces: ['gravel', 'asphalt'],
        showAuthorName: true,
        submittedAt: h.clock.now().toISOString(),
        decidedAt: null,
        rejection: null,
      },
    });
    const list = MyRoutePage.parse((await riderCall(h, me.token, 'GET', MY_ROUTES)).body);
    expect(list.items[0]?.publication?.status).toBe('pending');
    expect(await pendingQueue()).toEqual([id]);
    expect(await catalogIds()).toEqual([]);
    // действия райдера в журнал панели не пишутся (есть только вход модератора)
    expect(await panel(h).audit.countDocuments({ action: { $regex: /^route\./ } })).toBe(0);
    expect(await routesDb(h).routes.findOne({ _id: id })).toMatchObject({
      catalog: null,
      publication: {
        submissionCount: 1,
        version: 0,
        openReportCount: 0,
        lastReportAt: null,
        reportRevision: 0,
      },
    });
  });

  it('не готовый — 409 not_ready; на проверке — in_review; опубликованный — published; скрытый — hidden; тело — 400', async () => {
    const me = await rider();
    const processing = await seedRiderRoute(h, me.userId, { status: 'processing' });
    const failed = await seedRiderRoute(h, me.userId, { status: 'failed' });
    const cases: [string, string][] = [
      [processing, 'not_ready'],
      [failed, 'not_ready'],
      [
        await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, 'pending') }),
        'in_review',
      ],
      [
        await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, 'approved') }),
        'published',
      ],
      [await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, 'hidden') }), 'hidden'],
    ];
    for (const [id, reason] of cases) {
      const res = await submitPublication(h, me.token, id);
      expect(res.status, reason).toBe(409);
      expect(res.body).toMatchObject({ code: 'ROUTE_INVALID_STATE', details: { reason } });
    }
    const ready = await seedRiderRoute(h, me.userId);
    for (const body of [
      {},
      { city: 'minsk', surfaces: [], showAuthorName: false },
      { ...submissionBody(), extra: 1 },
      { city: 'moscow', surfaces: ['asphalt'], showAuthorName: false },
    ]) {
      expect((await submitPublication(h, me.token, ready, body)).status).toBe(400);
    }
  });
});

describe('отклонение и повторная подача (AC3)', () => {
  it('отклонён — причина и комментарий автору, canPublish; повторная подача — до 3 подач; 4-я — 409 route_submissions', async () => {
    const me = await rider();
    const id = await seedRiderRoute(h, me.userId);
    for (let i = 1; i <= 3; i += 1) {
      expect((await submitPublication(h, me.token, id)).status, `подача ${i}`).toBe(200);
      expect((await reject(id, i === 1 ? 'Старт у дома' : null)).status).toBe(200);
      const route = await myRoute(me.token, id);
      expect(route.publication).toMatchObject({
        status: 'rejected',
        rejection: { reason: 'dangerous', comment: i === 1 ? 'Старт у дома' : null },
        decidedAt: h.clock.now().toISOString(),
      });
      expect(route.canPublish).toBe(i < 3);
      expect(route.submissionsExhausted).toBe(i === 3);
    }
    const fourth = await submitPublication(h, me.token, id);
    expect(fourth.status).toBe(409);
    expect(fourth.body).toMatchObject({
      code: 'ROUTE_PUBLICATION_LIMIT',
      details: { limit: 'route_submissions', max: 3 },
    });
    expect(await catalogIds()).toEqual([]);
  });
});

describe('отзыв и снятие (AC4)', () => {
  it('отозвать pending — publication null, вне очереди; снять approved — вне каталога; повтор и отклонённый — 200 без записи', async () => {
    const me = await rider();
    const pending = await seedRiderRoute(h, me.userId);
    expect((await submitPublication(h, me.token, pending)).status).toBe(200);
    const withdrawn = await withdrawPublication(h, me.token, pending);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.headers['cache-control']).toBe('no-store');
    expect(MyRoute.parse(withdrawn.body)).toMatchObject({ publication: null, canPublish: true });
    expect(await pendingQueue()).toEqual([]);
    const again = await withdrawPublication(h, me.token, pending);
    expect(MyRoute.parse(again.body).publication).toBeNull();
    expect(await versionOf(pending)).toBe(1);

    const published = await seedRiderRoute(h, me.userId);
    expect((await submitPublication(h, me.token, published)).status).toBe(200);
    expect((await approve(published)).status).toBe(200);
    expect(await catalogIds()).toEqual([published]);
    expect((await myRoute(me.token, published)).publication?.status).toBe('approved');
    expect(
      MyRoute.parse((await withdrawPublication(h, me.token, published)).body).publication,
    ).toBeNull();
    expect(await catalogIds()).toEqual([]);
    expect((await call(h, 'GET', `/v1/routes/${published}`)).status).toBe(404);
    expect(await routesDb(h).routes.findOne({ _id: published })).toMatchObject({
      catalog: null,
      publication: { status: 'withdrawn' },
    });

    const rejected = await seedRiderRoute(h, me.userId, {
      publication: publicationDoc(h, 'rejected'),
    });
    const noop = await withdrawPublication(h, me.token, rejected);
    expect(noop.status).toBe(200);
    expect(MyRoute.parse(noop.body).publication?.status).toBe('rejected');
  });

  it('скрытый модератором — снять нельзя (409 hidden), переименовать — можно', async () => {
    const me = await rider();
    const id = await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, 'hidden') });
    const res = await withdrawPublication(h, me.token, id);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ROUTE_INVALID_STATE', details: { reason: 'hidden' } });
    expect(
      MyRoute.parse(
        (await riderCall(h, me.token, 'POST', `${MY_ROUTES}/${id}/rename`, { title: 'Новое' }))
          .body,
      ).title,
    ).toBe('Новое');
    expect((await myRoute(me.token, id)).publication?.status).toBe('hidden');
  });
});

describe('название заморожено (N6)', () => {
  it('pending и approved — 409 in_review/published без записи; rejected, hidden, withdrawn — 200', async () => {
    const me = await rider();
    const rename = (id: string, title: string) =>
      riderCall(h, me.token, 'POST', `${MY_ROUTES}/${id}/rename`, { title });
    for (const [status, reason] of [
      ['pending', 'in_review'],
      ['approved', 'published'],
    ] as const) {
      const id = await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, status) });
      const res = await rename(id, 'Новое название');
      expect(res.status, status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ROUTE_INVALID_STATE', details: { reason } });
      expect((await routesDb(h).routes.findOne({ _id: id }))?.title).toBe('Мой маршрут');
      // то же название — без записи и без отказа
      expect((await rename(id, 'Мой маршрут')).status).toBe(200);
    }
    for (const status of ['rejected', 'hidden', 'withdrawn'] as const) {
      const id = await seedRiderRoute(h, me.userId, { publication: publicationDoc(h, status) });
      expect((await rename(id, 'Новое название')).status, status).toBe(200);
    }
  });
});

describe('изоляция (N2)', () => {
  it('чужой, маршрут команды (того же пользователя) и неизвестный — один 404 на publish и unpublish; без входа — 401', async () => {
    const me = await rider();
    const other = await rider('other@example.com');
    const foreign = await seedRiderRoute(h, other.userId);
    const foreignPending = await seedRiderRoute(h, other.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    const team = await seedRiderRoute(h, me.userId);
    await routesDb(h).routes.updateOne({ _id: team }, { $set: { origin: 'platform' } });
    for (const id of [foreign, foreignPending, team, uuidv7()]) {
      for (const res of [
        await submitPublication(h, me.token, id),
        await withdrawPublication(h, me.token, id),
      ]) {
        expect(res.status, id).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
    expect((await routesDb(h).routes.findOne({ _id: foreignPending }))?.publication?.status).toBe(
      'pending',
    );
    expect((await routesDb(h).routes.findOne({ _id: team }))?.publication).toBeUndefined();
    expect((await submitPublication(h, undefined, foreign)).status).toBe(401);
    expect((await withdrawPublication(h, undefined, foreign)).status).toBe(401);
  });
});

describe('лимиты подач (N5, U8, 8.1 RC-7, RC-8)', () => {
  it('4-я заявка на рассмотрении — 409 pending; после отзыва — снова можно', async () => {
    const me = await rider();
    const routes = [];
    for (let i = 0; i < 4; i += 1) routes.push(await seedRiderRoute(h, me.userId));
    for (const id of routes.slice(0, 3)) {
      expect((await submitPublication(h, me.token, id)).status).toBe(200);
    }
    const fourth = await submitPublication(h, me.token, routes[3]!);
    expect(fourth.status).toBe(409);
    expect(fourth.body).toMatchObject({
      code: 'ROUTE_PUBLICATION_LIMIT',
      details: { limit: 'pending', max: 3 },
    });
    expect((await withdrawPublication(h, me.token, routes[0]!)).status).toBe(200);
    expect((await submitPublication(h, me.token, routes[3]!)).status).toBe(200);
    // заявки другого райдера не считаются
    const other = await rider('other@example.com');
    expect(
      (await submitPublication(h, other.token, await seedRiderRoute(h, other.userId))).status,
    ).toBe(200);
  });

  it('11-я успешная подача за сутки — 429 (3+3+3+1 через отзывы); отказы 409 квоту не тратят', async () => {
    const me = await rider();
    const routes = [];
    for (let i = 0; i < 5; i += 1) routes.push(await seedRiderRoute(h, me.userId));
    for (const id of routes.slice(0, 3)) {
      for (let i = 0; i < 3; i += 1) {
        expect((await submitPublication(h, me.token, id)).status).toBe(200);
        expect((await withdrawPublication(h, me.token, id)).status).toBe(200);
      }
      // 4-я подача маршрута — отказ без траты суточной квоты
      expect((await submitPublication(h, me.token, id)).status).toBe(409);
    }
    expect((await submitPublication(h, me.token, routes[3]!)).status).toBe(200);
    expect((await submitPublication(h, me.token, routes[3]!)).status).toBe(409);
    const limited = await submitPublication(h, me.token, routes[4]!);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await myRoute(me.token, routes[4]!)).publication).toBeNull();
  });

  it('параллельные подачи одного маршрута — одна заявка; проигравшие 409 суточную квоту не тратят (RC-8)', async () => {
    const me = await rider();
    const routes: string[] = [];
    for (let i = 0; i < 4; i += 1) routes.push(await seedRiderRoute(h, me.userId));
    for (const id of routes.slice(0, 2)) {
      for (let i = 0; i < 3; i += 1) {
        expect((await submitPublication(h, me.token, id)).status).toBe(200);
        expect((await withdrawPublication(h, me.token, id)).status).toBe(200);
      }
    }
    // отозван после 3-й подачи: заявки наружу нет, «Опубликовать» нет — причина флагом сервера
    expect(await myRoute(me.token, routes[0]!)).toMatchObject({
      publication: null,
      canPublish: false,
      submissionsExhausted: true,
    });
    expect((await myRoute(me.token, routes[3]!)).submissionsExhausted).toBe(false);
    // 6 успешных подач; все параллельные запросы проходят проверки состояния до первой записи (ворота)
    const PARALLEL = 4;
    const repository = h.app.get(RoutesRepository, { strict: false });
    const count = repository.countPendingOwn.bind(repository);
    let reached = 0;
    let release!: () => void;
    const all = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.spyOn(repository, 'countPendingOwn').mockImplementation(async (userId) => {
      reached += 1;
      if (reached === PARALLEL) release();
      await all;
      return count(userId);
    });
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () => submitPublication(h, me.token, routes[2]!)),
    );
    spy.mockRestore();
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await routesDb(h).routes.findOne({ _id: routes[2]! })).toMatchObject({
      publication: { status: 'pending', submissionCount: 1 },
    });
    // потрачено 7 из 10: ещё три успешные подачи, 11-я — 429
    for (let i = 0; i < 3; i += 1) {
      expect((await submitPublication(h, me.token, routes[3]!)).status).toBe(200);
      expect((await withdrawPublication(h, me.token, routes[3]!)).status).toBe(200);
    }
    const extra = await seedRiderRoute(h, me.userId);
    expect((await submitPublication(h, me.token, extra)).status).toBe(429);
  });
});
