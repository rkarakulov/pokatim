import { resolve } from 'node:path';

import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { latestMailText, passwordResetLink, verificationLink } from './mailpit';
import {
  NOT_FOUND_PATHS,
  REFRESH_URL,
  SIGN_IN_URL,
  UNKNOWN_RACE_ID,
  UNKNOWN_RIDE_ID,
  UNKNOWN_ROUTE_ID,
  UNKNOWN_START_ID,
} from './project';
import { cancelRideByApi, rideFixtureDate, signInRider } from './ride-fixture';
import {
  HOME_FIXTURE_PASSWORD,
  HOME_FIXTURE_YEAR,
  publishCalendarData,
  publishCatalogRoute,
  publishHomeData,
  publishRaceData,
  registerHomeRider,
} from './schedule-fixture';
import { API_URL, BASE_URL, DEV_URL, WITH_API } from './urls';

// Смоук web-версии pokatim: SSR → гидрация → гард сессии, публичные экраны с OG, витрина (dev), PWA;
// с API (E2E_API=1) — регистрация → письмо → подтверждение → вход → опрос «Что вас привело?» → геопозиция «Не сейчас» →
// Главная → вход переживает перезагрузку (cookie) →
// выход → вход по паролю (неверный пароль — баннер) → перезагрузка → выход → «Забыли пароль?» → письмо → новый пароль
// → старый пароль не подходит → вход новым → письмо «Пароль изменён»; вход в браузере с выданным разрешением
// геопозиции — шаг геопозиции пропущен. Главная (блок 02): порядок разделов по опросу, герои по публичному API;
// гонка и старт, опубликованные через API панели (`schedule-fixture.ts`), — герои с названиями. Гонки и сезон (блок 03):
// публичные карточка гонки и сезон по ссылке без входа (SSR + OG без ПДн, отменённая — баннер), вкладка «Гонки» после
// входа — герой, группы, чип класса, переход в карточку и в сезон. Календарь (блок 04): публичная карточка старта по
// ссылке без входа (SSR + OG без ПДн), «Регистрация у организатора» — новая вкладка без opener, вкладка «Календарь»
// после входа — чип месяца, подпись группы, переход в карточку и назад. Кофе-райды (блок 05): райдер A создаёт райд
// формой → вкладка «Райды»; гость — карточка по ссылке (SSR, OG без ПДн, всегда noindex); райдер B — «Я иду» → «Вы
// идёте»; A отменяет → гость видит «Райд отменён».
// Ошибки страницы (исключения, рассинхрон гидрации, неожиданные отказы загрузки) проверяет фикстура (fixtures.ts);
// ожидаемый 401 восстановления сессии анонима — в e2e/project.ts.

/** Cookie refresh web-сессии — как задано (task.md F5b §7), а не импорт из contracts: смоук проверяет ответ API. */
const SESSION_COOKIE = { name: '__Secure-pokatim_rt', path: '/v1/auth/session' };
/** Ответ опроса онбординга (слайс 4) — первый эндпоинт под AuthGuard. */
const SURVEY_URL = `${API_URL}/v1/profile/onboarding/survey`;
/** Шаг «Подключите устройство» (tracks-devices): флаг аккаунта на сервере. */
const DEVICES_STEP_URL = `${API_URL}/v1/profile/onboarding/devices`;
/** GPX-фикстура пакета треков (синтетический заезд, без персональных данных). */
const GPX_FIXTURE = resolve(__dirname, '../../../packages/tracks/src/__fixtures__/komoot.gpx');

/**
 * Герои разделов Главной (блок 02) — по публичному API: первая гонка `scope=current` и первый старт календаря (их же
 * запрашивает приложение); пусто — пустые герои разделов.
 */
async function expectHomeHeroes(page: Page, request: APIRequestContext) {
  const races = await (await request.get(`${API_URL}/v1/races?scope=current&limit=1`)).json();
  const starts = await (await request.get(`${API_URL}/v1/calendar?limit=1`)).json();
  const race = races.items[0]?.title as string | undefined;
  const start = starts.items[0]?.title as string | undefined;
  await expect(page.getByText(race ?? 'Пока нет открытых гонок', { exact: true })).toBeVisible();
  await expect(
    page.getByText(start ?? 'Пока нет стартов в календаре', { exact: true }),
  ).toBeVisible();
}

/** Карточка кофе-райда на странице (вкладки остаются в DOM — тексты ищем только в ней). */
const card = (page: Page) => page.getByTestId('ride-detail');

/** Заголовки разделов Главной сверху вниз. */
const homeSections = (page: Page) =>
  page.getByRole('heading', { name: /^(Ближайшие (гонки|старты)|Маршруты команды)$/ });

/**
 * Главная гостя после гидрации. С API: восстановление сессии — 401, гард ведёт на регистрацию. Без API: сеть
 * недоступна — это не выход (pokatim-app.md, «Сессия в вебе»): Главная остаётся, «Нет соединения» с повтором.
 */
async function expectGuestHome(page: Page) {
  if (WITH_API) {
    await expect(page).toHaveURL(`${BASE_URL}/register`);
    await expect(page.getByText('Создать аккаунт', { exact: true })).toBeVisible();
    return;
  }
  await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  await expect(page).toHaveURL(`${BASE_URL}/`);
}

test('Главная без входа: HTML с сервера (скелетон оболочки), после гидрации — регистрация (без API — «Нет соединения»)', async ({
  page,
  request,
}) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<div id="root"');

  await page.goto('/');
  await expectGuestHome(page);
});

test('публичный экран /register: форма, заголовок и OG в HTML до JS', async ({ page, request }) => {
  const html = await (await request.get('/register')).text();
  expect(html).toContain('Создать аккаунт');
  expect(html).toContain('<title>Регистрация — Покатим</title>');
  expect(html).toMatch(/<meta property="og:title" content="Регистрация"/);
  expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/register"`);

  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toBeVisible();
  await expect(page).toHaveTitle('Регистрация — Покатим');
});

test('публичный экран /sign-in: форма, заголовок и OG в HTML до JS, без персональных данных', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/sign-in')).text();
  expect(html).toContain('Войдите по e-mail и паролю');
  expect(html).toContain('<title>Вход — Покатим</title>');
  expect(html).toMatch(/<meta property="og:title" content="Вход"/);
  expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/sign-in"`);
  // мета — без e-mail и других ПДн
  expect(html.match(/<meta [^>]*>/g)?.join('\n')).not.toContain('@');

  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Пароль' })).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
  await expect(page).toHaveTitle('Вход — Покатим');
});

// экран после гидрации (состояние ссылки из API) — в сценарии «с API»: неизвестный токен дал бы 404 в консоли
test('ссылка из письма /auth/verify/<токен>: HTML с сервера без og:url и без токена в мета', async ({
  request,
}) => {
  const token = 'x'.repeat(43);
  const response = await request.get(`/auth/verify/${token}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<title>Подтвердите e-mail — Покатим</title>');
  expect(html).toMatch(/<meta property="og:title" content="Подтвердите e-mail"/);
  expect(html).not.toContain('og:url');
  expect(html.match(/<meta [^>]*>/g)?.join('\n')).not.toContain(token);
});

test('публичный экран /forgot-password: форма, заголовок и OG в HTML до JS, без персональных данных', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/forgot-password')).text();
  expect(html).toContain('Укажите e-mail аккаунта');
  expect(html).toContain('<title>Восстановление пароля — Покатим</title>');
  expect(html).toMatch(/<meta property="og:title" content="Восстановление пароля"/);
  expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/forgot-password"`);
  expect(html.match(/<meta [^>]*>/g)?.join('\n')).not.toContain('@');

  await page.goto('/forgot-password');
  await expect(page.getByRole('button', { name: 'Отправить ссылку' })).toBeVisible();
  await expect(page).toHaveTitle('Восстановление пароля — Покатим');
});

// экран после гидрации — в сценарии «с API»: неизвестный токен дал бы 404 в консоли
test('ссылка сброса /auth/reset/<токен>: HTML с сервера без og:url и токена в мета, Referrer-Policy: no-referrer', async ({
  request,
}) => {
  const token = 'y'.repeat(43);
  const response = await request.get(`/auth/reset/${token}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  const html = await response.text();
  expect(html).toContain('<title>Новый пароль — Покатим</title>');
  expect(html).toMatch(/<meta property="og:title" content="Новый пароль"/);
  expect(html).not.toContain('og:url');
  expect(html.match(/<meta [^>]*>/g)?.join('\n')).not.toContain(token);
  // прочие страницы — прежняя политика
  expect((await request.get('/sign-in')).headers()['referrer-policy']).toBe(
    'strict-origin-when-cross-origin',
  );
});

test('шаги онбординга /survey и /location без сессии: HTML скелетона оболочки, после гидрации — гость', async ({
  page,
  request,
}) => {
  for (const path of ['/survey', '/location']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('role="progressbar"');
    // экраны не публичные: без содержимого шага и без OG
    expect(html).not.toContain('Что вас привело?');
    expect(html).not.toContain('Покажем, что рядом');
    expect(html).not.toContain('og:title');
  }

  await page.goto('/survey');
  if (WITH_API) {
    await expect(page).toHaveURL(`${BASE_URL}/register`);
  } else {
    // без API сессия не проверена — не выход: ошибка с повтором на месте шага
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
});

test('публичный экран /status: заголовок и OG в HTML до JS, после гидрации — тот же экран', async ({
  page,
  request,
}) => {
  const html = await (await request.get('/status')).text();
  expect(html).toContain('Статус сервиса');
  expect(html).toMatch(/<meta property="og:title" content="Статус сервиса"/);

  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Статус сервиса' })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Статус сервиса',
  );
  await expect(page).toHaveTitle(/^Статус сервиса — /);
});

test('публичная карточка неизвестной гонки: HTML 200 (с API — noindex), после гидрации — «Гонка не найдена» (без API — «Нет соединения»)', async ({
  page,
  request,
}) => {
  const response = await request.get(`/races/${UNKNOWN_RACE_ID}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<meta property="og:title" content="Гонка"/);
  // noindex — только когда API ответил 404; API недоступен — нейтральная мета без robots
  if (WITH_API) expect(html).toMatch(/<meta name="robots" content="noindex"/);
  else expect(html).not.toContain('name="robots"');
  expect(html).not.toContain('og:url');

  await page.goto(`/races/${UNKNOWN_RACE_ID}`);
  if (WITH_API) {
    await expect(page.getByText('Гонка не найдена', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Все гонки' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
  // публичный экран вне гардов: гостя не уводит на регистрацию
  await expect(page).toHaveURL(`${BASE_URL}/races/${UNKNOWN_RACE_ID}`);
});

test('публичная карточка неизвестного старта: HTML 200 (с API — noindex), после гидрации — «Старт не найден» (без API — «Нет соединения»)', async ({
  page,
  request,
}) => {
  const response = await request.get(`/calendar/${UNKNOWN_START_ID}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<meta property="og:title" content="Старт календаря"/);
  if (WITH_API) expect(html).toMatch(/<meta name="robots" content="noindex"/);
  else expect(html).not.toContain('name="robots"');
  expect(html).not.toContain('og:url');

  await page.goto(`/calendar/${UNKNOWN_START_ID}`);
  if (WITH_API) {
    await expect(page.getByText('Старт не найден', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Все старты' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
  await expect(page).toHaveURL(`${BASE_URL}/calendar/${UNKNOWN_START_ID}`);
});

test('публичная карточка неизвестного кофе-райда: HTML 200 + noindex всегда, после гидрации — «Райд не найден» (без API — «Нет соединения»)', async ({
  page,
  request,
}) => {
  const response = await request.get(`/rides/${UNKNOWN_RIDE_ID}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<meta property="og:title" content="Кофе-райд"/);
  expect(html).toMatch(/<meta name="robots" content="noindex"/);
  expect(html).not.toContain('og:url');

  await page.goto(`/rides/${UNKNOWN_RIDE_ID}`);
  if (WITH_API) {
    await expect(page.getByText('Райд не найден', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Все райды' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
  await expect(page).toHaveURL(`${BASE_URL}/rides/${UNKNOWN_RIDE_ID}`);
});

test('публичная карточка неизвестного маршрута (routes-01): HTML 200 (с API — noindex), после гидрации — «Маршрут недоступен» (без API — «Нет соединения»)', async ({
  page,
  request,
}) => {
  const response = await request.get(`/routes/${UNKNOWN_ROUTE_ID}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<meta property="og:title" content="Маршрут"/);
  if (WITH_API) expect(html).toMatch(/<meta name="robots" content="noindex"/);
  else expect(html).not.toContain('name="robots"');
  expect(html).not.toContain('og:url');

  await page.goto(`/routes/${UNKNOWN_ROUTE_ID}`);
  if (WITH_API) {
    await expect(page.getByText('Маршрут недоступен', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Все маршруты' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
  // публичный экран вне гардов: гостя не уводит на регистрацию
  await expect(page).toHaveURL(`${BASE_URL}/routes/${UNKNOWN_ROUTE_ID}`);
});

test('жалоба на райд /rides/report/<id> без сессии (05b): HTML без формы и OG, после гидрации — гард входа', async ({
  page,
  request,
}) => {
  const response = await request.get(`/rides/report/${UNKNOWN_RIDE_ID}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  // экран не публичный: без формы жалобы и без OG
  expect(html).not.toContain('Причина жалобы');
  expect(html).not.toContain('og:title');

  await page.goto(`/rides/report/${UNKNOWN_RIDE_ID}`);
  if (WITH_API) {
    await expect(page).toHaveURL(`${BASE_URL}/register`);
  } else {
    await expect(page.getByRole('heading', { name: 'Нет соединения' })).toBeVisible();
  }
});

test('неизвестный адрес, /_sitemap и витрина /ui-kit в production — «Страница не найдена»', async ({
  page,
}) => {
  for (const path of NOT_FOUND_PATHS) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
    await expect(page.getByText('Unmatched Route')).toHaveCount(0);
  }
  await page.goto('/ui-kit');
  await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  await expect(page.getByText('Кнопки', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'На главную' }).click();
  await expectGuestHome(page);
});

test('витрина /ui-kit (dev-сборка): заголовок и разделы', async ({ page }) => {
  await page.goto(`${DEV_URL}/ui-kit`);
  await expect(page.getByRole('heading', { name: 'Витрина компонентов' })).toBeVisible();
  for (const section of ['Кнопки', 'Поля и выбор', 'Пустое состояние']) {
    await expect(page.getByText(section, { exact: true })).toBeVisible();
  }
});

test('PWA: manifest бренда без ошибок, устанавливается, service worker активен', async ({
  page,
}) => {
  await page.goto('/');
  const scriptURL = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL,
  );
  expect(scriptURL).toMatch(/\/sw\.js$/);

  const cdp = await page.context().newCDPSession(page);
  const { errors: manifestErrors, data } = await cdp.send('Page.getAppManifest');
  expect(manifestErrors).toEqual([]);
  expect(JSON.parse(data ?? '{}')).toMatchObject({ name: 'Покатим', theme_color: '#FFFFFF' });
  // контекст Playwright — инкогнито: эта причина есть всегда, остальные — реальные проблемы PWA
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.filter(({ errorId }) => errorId !== 'in-incognito')).toEqual([]);
});

test.describe('с API', () => {
  test.skip(!WITH_API, 'нужны API, worker, MongoDB, Redis и Mailpit: E2E_API=1 (runbook, «Web»)');

  test('регистрация → письмо → подтверждение → вход → опрос и геопозиция; вход переживает перезагрузку (cookie)', async ({
    browser,
    page,
    context,
    request,
    watchErrors,
  }) => {
    const email = `e2e-${Date.now()}@pokatim.test`;

    await page.goto('/');
    await expect(page).toHaveURL(`${BASE_URL}/register`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Пароль').fill('e2e-пароль-pokatim');
    await page.getByLabel('Дата рождения').fill('1990-05-15');
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await expect(page.getByText('Подтвердите e-mail', { exact: true })).toBeVisible();

    // ссылка письма для web — маршрут приложения (APP_LINK_BASE web)
    const link = await verificationLink(request, email);
    expect(link).toMatch(new RegExp(`^${BASE_URL}/auth/verify/[\\w-]{43}$`));

    // первая вкладка опрашивает подтверждение: ответ с сессией — без refresh в теле
    const verified = page.waitForResponse(
      async (response) =>
        response.url() === `${API_URL}/v1/auth/registration/poll` &&
        response.request().method() === 'POST' &&
        (await response.json()).state === 'verified',
    );

    // письмо открыто в другой вкладке того же браузера
    const mail = await context.newPage();
    watchErrors(mail);
    await mail.goto(link);
    await expect(mail).toHaveTitle('Подтвердите e-mail — Покатим');
    await mail.getByRole('button', { name: 'Подтвердить e-mail' }).click();
    await expect(mail.getByText('E-mail подтверждён', { exact: true })).toBeVisible();

    const poll = await (await verified).json();
    expect(Object.keys(poll.session).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'refreshTokenExpiresAt',
    ]);

    // онбординг после первого входа: опрос (ответ — на сервер с Bearer) → геопозиция «Не сейчас» → Главная
    await expect(page).toHaveURL(`${BASE_URL}/survey`);
    const submit = page.getByRole('button', { name: 'Продолжить' });
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Новые маршруты' }).click();
    await page.getByRole('checkbox', { name: 'Календарь стартов' }).click();
    const surveySaved = page.waitForResponse(
      (response) => response.url() === SURVEY_URL && response.request().method() === 'PUT',
    );
    await submit.click();
    const saved = await surveySaved;
    expect(saved.status()).toBe(200);
    expect(saved.request().headers().authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(await saved.json()).toEqual({ surveyCompleted: true, devicesStepCompleted: false });
    await expect(page).toHaveURL(`${BASE_URL}/location`);
    await expect(page.getByRole('heading', { name: 'Покажем, что рядом' })).toBeVisible();
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    // шаг «Подключите устройство» (tracks-devices): «Позже» — флаг аккаунта на сервере → Главная
    await expect(page).toHaveURL(`${BASE_URL}/devices`);
    await expect(page.getByRole('heading', { name: 'Подключите устройство' })).toBeVisible();
    const devicesStep = page.waitForResponse(
      (response) => response.url() === DEVICES_STEP_URL && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Позже' }).click();
    expect(await (await devicesStep).json()).toEqual({
      surveyCompleted: true,
      devicesStepCompleted: true,
    });
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(page.getByRole('heading', { name: 'Покатим' })).toBeVisible();

    // Главная (блок 02): «Новые маршруты» и «Календарь стартов» отмечены в опросе — разделы первыми (в порядке вкладок)
    // с тегом; герои или пустые герои
    await expect(page).toHaveTitle('Главная — Покатим');
    await expect(homeSections(page)).toHaveText([
      'Маршруты команды',
      'Ближайшие старты',
      'Ближайшие гонки',
    ]);
    await expect(page.getByText('по вашему выбору', { exact: true })).toHaveCount(2);
    await expectHomeHeroes(page, request);

    // refresh — только в httpOnly cookie на пути сессии; JS страницы его не видит
    const cookies = await context.cookies();
    expect(cookies.find(({ name }) => name === SESSION_COOKIE.name)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: SESSION_COOKIE.path,
    });
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE.name);

    // перезагрузка: access в памяти потерян, сессия восстанавливается по cookie (ротация refresh)
    const refreshed = page.waitForResponse(REFRESH_URL);
    await page.reload();
    expect((await refreshed).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Покатим' })).toBeVisible();

    // выход: сервер отзывает сессию и стирает cookie, гард ведёт на «Вход» (на устройстве уже входили)
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/sign-in`);
    await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
    expect(
      (await context.cookies()).find(({ name }) => name === SESSION_COOKIE.name),
    ).toBeUndefined();

    // неверный пароль — нейтральный баннер (по роли: скрытая под «Входом» регистрация в стеке тоже имеет поля)
    await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
    await page.getByRole('textbox', { name: 'Пароль' }).fill('не-тот-пароль');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Неверный e-mail или пароль.')).toBeVisible();

    // вход по паролю: сессия без refresh в теле, refresh — в httpOnly cookie
    const signedIn = page.waitForResponse(
      (response) => response.url() === SIGN_IN_URL && response.status() === 200,
    );
    await page.getByRole('textbox', { name: 'Пароль' }).fill('e2e-пароль-pokatim');
    await page.getByRole('button', { name: 'Войти' }).click();
    const signInBody = await (await signedIn).json();
    expect(signInBody.state).toBe('signedIn');
    expect(signInBody.session).not.toHaveProperty('refreshToken');
    await expect(page.getByRole('heading', { name: 'Покатим' })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE.name);

    // и вход по паролю переживает перезагрузку
    const restored = page.waitForResponse(REFRESH_URL);
    await page.reload();
    expect((await restored).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Покатим' })).toBeVisible();

    // сброс пароля: выход → «Забыли пароль?» (e-mail переносится из формы входа) → письмо со ссылкой
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/sign-in`);
    await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/forgot-password`);
    await expect(page.getByRole('textbox', { name: 'E-mail' })).toHaveValue(email);
    await page.getByRole('button', { name: 'Отправить ссылку' }).click();
    await expect(page.getByText('Проверьте почту', { exact: true })).toBeVisible();

    const resetLink = await passwordResetLink(request, email);
    expect(resetLink).toMatch(new RegExp(`^${BASE_URL}/auth/reset/[\\w-]{43}$`));
    await page.goto(resetLink);
    await expect(page).toHaveTitle('Новый пароль — Покатим');
    const newPassword = 'новый-пароль-pokatim';
    const fresh = page.getByRole('textbox', { name: 'Новый пароль' });
    await expect(fresh).toHaveAttribute('autocomplete', 'new-password');
    await fresh.fill(newPassword);
    await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(newPassword);
    await page.getByRole('button', { name: 'Сохранить пароль' }).click();
    await expect(page.getByText('Пароль изменён', { exact: true })).toBeVisible();

    // «Войти» → «Вход» с e-mail аккаунта; старый пароль не подходит, новый — вход
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/sign-in`);
    await expect(page.getByRole('textbox', { name: 'E-mail' })).toHaveValue(email);
    await page.getByRole('textbox', { name: 'Пароль' }).fill('e2e-пароль-pokatim');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Неверный e-mail или пароль.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Пароль' }).fill(newPassword);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('heading', { name: 'Покатим' })).toBeVisible();

    // уведомление о смене пароля — без ссылки с токеном
    const changed = await latestMailText(request, `to:"${email}" subject:"Пароль изменён"`);
    expect(changed).toContain('по минскому времени');
    expect(changed).not.toMatch(/auth\/reset/);

    // другой браузер с уже выданным разрешением геопозиции: опрос пройден (сервер), шаг геопозиции пропущен
    const granted = await browser.newContext({ permissions: ['geolocation'] });
    const other = await granted.newPage();
    watchErrors(other);
    await other.goto('/sign-in');
    await other.getByRole('textbox', { name: 'E-mail' }).fill(email);
    await other.getByRole('textbox', { name: 'Пароль' }).fill(newPassword);
    await other.getByRole('button', { name: 'Войти' }).click();
    await expect(other.getByRole('heading', { name: 'Покатим' })).toBeVisible();
    await expect(other).toHaveURL(`${BASE_URL}/`);
    // перезагрузка: онбординг снова по серверу — Главная
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Покатим' })).toBeVisible();
    await granted.close();
  });

  test('Главная с данными: опубликованные через API панели гонка и старт — герои с названиями (AC8)', async ({
    page,
    request,
  }) => {
    const { raceTitle, startTitle, withdraw } = await publishHomeData(request);
    try {
      // публичное чтение видит свои записи года смоука (без входа)
      const month = `${HOME_FIXTURE_YEAR}-06`;
      const races = await (
        await request.get(`${API_URL}/v1/races`, {
          params: { scope: 'current', month, limit: 50 },
        })
      ).json();
      expect(races.items.map((item: { title: string }) => item.title)).toContain(raceTitle);
      const starts = await (
        await request.get(`${API_URL}/v1/calendar`, { params: { month, limit: 50 } })
      ).json();
      expect(starts.items.map((item: { title: string }) => item.title)).toContain(startTitle);

      // райдер прогона входит в приложение: опрос «Гонки и результаты» → геопозиция → Главная
      const rider = await registerHomeRider(request);
      await page.goto('/sign-in');
      await page.getByRole('textbox', { name: 'E-mail' }).fill(rider);
      await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/survey`);
      await page.getByRole('checkbox', { name: 'Гонки и результаты' }).click();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await page.getByRole('button', { name: 'Не сейчас' }).click();
      await page.getByRole('button', { name: 'Позже' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/`);

      await expect(homeSections(page)).toHaveText([
        'Ближайшие гонки',
        'Маршруты команды',
        'Ближайшие старты',
      ]);
      await expect(page.getByText('по вашему выбору', { exact: true })).toHaveCount(1);
      await expect(page.getByText('Окно гонки', { exact: true })).toBeVisible();
      await expect(page.getByText('Ближайший старт', { exact: true })).toBeVisible();
      // герой — ближайшая запись публичного API (в dev-БД это может быть не запись смоука)
      await expectHomeHeroes(page, request);
    } finally {
      await withdraw();
    }
  });

  test('«Устройства»: загрузка GPX-файла → «Обрабатываем…» → «Готово» (tracks-devices, AC15)', async ({
    page,
    request,
  }) => {
    const rider = await registerHomeRider(request);
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'E-mail' }).fill(rider);
    await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/survey`);
    await page.getByRole('checkbox', { name: 'Пока просто смотрю' }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Не сейчас' }).click();
    await page.getByRole('button', { name: 'Позже' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`);

    // вход — иконка верхней панели; устройства на стенде смоука выключены — только ручная загрузка
    await page.getByRole('button', { name: 'Устройства' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/settings/devices`);
    await expect(page.getByRole('heading', { name: 'Устройства' })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Загрузить файл' }).click();
    await (await chooser).setFiles(GPX_FIXTURE);
    // разбор — worker (outbox → BullMQ → worker_threads); экран опрашивает статус, пока загрузка не завершена
    await expect(page.getByText('komoot.gpx: Готово', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Готово', { exact: true }).first()).toBeVisible();
  });

  test('Гонки и сезон (блок 03): карточка и сезон по ссылке без входа (SSR, OG без ПДн), вкладка «Гонки» после входа', async ({
    page,
    request,
  }) => {
    const { seasonId, race, corridorRace, cancelled, withdraw } = await publishRaceData(request);
    try {
      // SSR карточки: название и OG до JS, og:url — из WEB_ORIGIN, без e-mail и служебных полей
      const html = await (await request.get(`/races/${race.id}`)).text();
      expect(html).toContain(`<meta property="og:title" content="${race.title}"`);
      expect(html).toContain(
        `<meta property="og:description" content="1–3 июля ${HOME_FIXTURE_YEAR} · Гравий · 62 км"`,
      );
      expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/races/${race.id}"`);
      expect(html).not.toMatch(/@pokatim\.test|ownerUserId|noindex/);
      const season = (await (await request.get(`${API_URL}/v1/seasons/${seasonId}`)).json()) as {
        name: string;
      };
      const seasonHtml = await (await request.get(`/seasons/${seasonId}`)).text();
      expect(seasonHtml).toContain(`<meta property="og:title" content="${season.name}"`);
      expect(seasonHtml).toContain(
        `<meta property="og:description" content="1 января–31 декабря ${HOME_FIXTURE_YEAR}"`,
      );

      // гость открывает карточку: поля, ссылка сезона → экран сезона (вне гардов)
      await page.goto(`/races/${race.id}`);
      await expect(page.getByText(race.title, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`1–3 июля ${HOME_FIXTURE_YEAR}, до 15:00`)).toBeVisible();
      await expect(page).toHaveTitle(`${race.title} — Покатим`);
      // без коридора — ни «Участвовать», ни «Результатов»
      await expect(page.getByRole('button', { name: 'Участвовать' })).toHaveCount(0);
      await expect(page.getByText('Результаты', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: season.name }).click();
      await expect(page).toHaveURL(`${BASE_URL}/seasons/${seasonId}`);
      await expect(page.getByRole('heading', { name: season.name })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Гонки сезона' })).toBeVisible();
      await expect(page.getByText('Таблица сезона')).toHaveCount(0);

      // гонка с эталонным коридором (race-results-01): допуск и дистанция по маршруту
      await page.goto(`/races/${corridorRace.id}`);
      await expect(page.getByText(corridorRace.title, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Коридор', { exact: true })).toBeVisible();
      await expect(page.getByText('±50 м от маршрута')).toBeVisible();
      await expect(page.getByText(/^10,6\s?км по GPS-треку$/)).toBeVisible();
      // участие (race-results-04, F16): гостю на гонке с коридором до окна — «Участвовать» со входом
      await expect(page.getByRole('button', { name: 'Участвовать' })).toBeVisible();
      await expect(page.getByText('Войдите, чтобы участвовать')).toBeVisible();

      // отменённая — баннер с причиной, без строк окна
      await page.goto(`/races/${cancelled.id}`);
      await expect(
        page.getByText('Гонка отменена. Причина: Неблагоприятные погодные условия.'),
      ).toBeVisible();
      await expect(page.getByText('Протокол', { exact: true })).toHaveCount(0);

      // вкладка «Гонки» после входа: герой — первая current-гонка публичного API
      const rider = await registerHomeRider(request);
      await page.goto('/sign-in');
      await page.getByRole('textbox', { name: 'E-mail' }).fill(rider);
      await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/survey`);
      await page.getByRole('checkbox', { name: 'Гонки и результаты' }).click();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await page.getByRole('button', { name: 'Не сейчас' }).click();
      await page.getByRole('button', { name: 'Позже' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/`);
      await page.getByRole('tab', { name: 'Гонки' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/races`);

      const current = (await (
        await request.get(`${API_URL}/v1/races`, { params: { scope: 'current', limit: 20 } })
      ).json()) as { items: { id: string; title: string }[]; nextCursor: string | null };
      const first = current.items[0];
      expect(first, 'опубликованная гонка прогона — в current').toBeDefined();
      const hero = page.getByRole('link', { name: new RegExp(`^Ближайшая гонка\\. `) });
      await expect(hero).toContainText(first!.title);
      if (current.nextCursor === null) {
        await expect(page.getByText('Завершённые', { exact: true })).toBeVisible();
      }

      // чип класса — запрос с bikeClass; «Сбросить фильтры» снимает
      const filtered = page.waitForRequest(
        (req) =>
          req.url().startsWith(`${API_URL}/v1/races?`) && req.url().includes('bikeClass=mtb'),
      );
      await page.getByRole('button', { name: 'МТБ', exact: true }).click();
      await filtered;
      await page.getByText('Сбросить фильтры', { exact: true }).first().click();
      await expect(page.getByRole('button', { name: 'МТБ', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      // герой → карточка; «Назад» — во вкладку; кнопка сезона → экран сезона
      await page.getByRole('link', { name: new RegExp(`^Ближайшая гонка\\. `) }).click();
      await expect(page).toHaveURL(`${BASE_URL}/races/${first!.id}`);
      await page.getByRole('button', { name: 'Назад' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/races`);
      const seasonButton = page.getByRole('button', { name: /Сезон/ }).first();
      await seasonButton.click();
      await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/seasons/`));
      await expect(page.getByRole('heading', { name: 'Гонки сезона' })).toBeVisible();

      // «Выбрать свой заезд» (race-results-04, F16): экран за входом; у нового райдера заездов в окне нет
      await page.goto(`/races/pick/${corridorRace.id}`);
      await expect(page.getByText('Выбрать свой заезд', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Нет заездов в окне гонки')).toBeVisible();
    } finally {
      await withdraw();
    }
  });

  test('Маршруты (routes-01, routes-02, routes-03): карточка маршрута каталога по ссылке без входа (SSR, OG без ПДн, профиль высоты, «Скачать GPX»), вкладка «Маршруты» после входа, «Мои» — пусто', async ({
    page,
    request,
  }) => {
    const route = await publishCatalogRoute(request);
    try {
      // routes-03: производные данные (профиль, GPX) — у нового маршрута сразу, у маршрута до слайса — после бэкфилла
      // при старте worker; ждём опросом API (SSR-кэш процесса — 60 с, поэтому до первого запроса HTML карточки)
      await expect
        .poll(
          async () =>
            (
              (await (await request.get(`${API_URL}/v1/routes/${route.id}`)).json()) as {
                gpxAvailable?: boolean;
              }
            ).gpxAvailable,
          { timeout: 60_000 },
        )
        .toBe(true);
      // SSR карточки: название и OG до JS, og:url — из WEB_ORIGIN, без e-mail и служебных полей
      const html = await (await request.get(`/routes/${route.id}`)).text();
      expect(html).toContain(`<meta property="og:title" content="${route.title}"`);
      expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/routes/${route.id}"`);
      expect(html).toMatch(/<meta property="og:description" content="[^"]*км[^"]*· Минск"/);
      expect(html).not.toMatch(/@pokatim\.test|ownerUserId|sha256|noindex/);
      // routes-03: SSR рендерит профиль высоты и его текстовую альтернативу
      expect(html).toContain('Профиль высоты');
      expect(html).toMatch(/Профиль высоты: от \d+ до \d+ м/);

      // гость открывает карточку по ссылке: стат-блок, чипы, профиль (вне гардов); консоль без ошибок гидрации
      await page.goto(`/routes/${route.id}`);
      await expect(page.getByText(route.title, { exact: true }).first()).toBeVisible();
      await expect(page).toHaveTitle(`${route.title} — Покатим`);
      await expect(page.getByText('Дистанция', { exact: true })).toBeVisible();
      await expect(page.getByText('В пути', { exact: true })).toBeVisible();
      await expect(page.getByText('Минск', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('img', { name: /^Профиль высоты: от / })).toBeVisible();
      await expect(page).toHaveURL(`${BASE_URL}/routes/${route.id}`);

      // «Скачать GPX»: скачивание файла, страница остаётся
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Скачать GPX' }).click();
      expect((await downloaded).suggestedFilename()).toMatch(/\.gpx$/);
      await expect(page).toHaveURL(`${BASE_URL}/routes/${route.id}`);
      const gpx = await request.get(`${API_URL}/v1/routes/${route.id}/gpx`);
      expect(gpx.status()).toBe(200);
      expect(gpx.headers()['content-disposition']).toMatch(/^attachment;/);
      expect(await gpx.text()).not.toMatch(/<time|<metadata|<extensions/);

      // вкладка «Маршруты» после входа: маршрут прогона — в каталоге
      const rider = await registerHomeRider(request);
      await page.goto('/sign-in');
      await page.getByRole('textbox', { name: 'E-mail' }).fill(rider);
      await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/survey`);
      await page.getByRole('checkbox', { name: 'Гонки и результаты' }).click();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await page.getByRole('button', { name: 'Не сейчас' }).click();
      await page.getByRole('button', { name: 'Позже' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/`);
      await page.getByRole('tab', { name: 'Маршруты' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/routes`);
      const listCard = page.getByRole('link', { name: new RegExp(`^${route.title}\\. `) });
      await expect(listCard.first()).toBeVisible();
      await listCard.first().click();
      await expect(page).toHaveURL(`${BASE_URL}/routes/${route.id}`);

      // routes-02: «Мои» — новый райдер без маршрутов; `?view=mine` переживает перезагрузку
      await page.goto('/routes');
      await page.getByRole('tab', { name: 'Мои', exact: true }).click();
      await expect(page).toHaveURL(`${BASE_URL}/routes?view=mine`);
      await expect(page.getByText('У вас пока нет маршрутов')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Загрузить маршрут' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'до 50 км' })).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Мои', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByText('У вас пока нет маршрутов')).toBeVisible();
    } finally {
      await route.withdraw();
    }
  });

  test('Календарь (блок 04): карточка старта по ссылке без входа (SSR, OG без ПДн), регистрация — новая вкладка, вкладка «Календарь» после входа', async ({
    page,
    request,
    context,
  }) => {
    const { start, multiDay, withdraw } = await publishCalendarData(request);
    try {
      // SSR карточки: название и OG до JS, og:url — из WEB_ORIGIN, без e-mail и служебных полей
      const html = await (await request.get(`/calendar/${start.id}`)).text();
      expect(html).toContain(`<meta property="og:title" content="${start.title}"`);
      expect(html).toContain(
        `<meta property="og:description" content="20 июня ${HOME_FIXTURE_YEAR} · Шоссе · Смоук · 100 и 60 км"`,
      );
      expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/calendar/${start.id}"`);
      expect(html).not.toMatch(/@pokatim\.test|createdByUserId|cityKey|noindex/);

      // гость: поля карточки, «Регистрация у организатора» — новая вкладка без window.opener
      await context.route('https://example.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<p>организатор</p>' }),
      );
      await page.goto(`/calendar/${start.id}`);
      await expect(page.getByText(start.title, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Старт в 8:00 · Смоук, Площадь смоука')).toBeVisible();
      await expect(page).toHaveTitle(`${start.title} — Покатим`);
      const popup = context.waitForEvent('page');
      await page.getByRole('button', { name: 'Регистрация у организатора' }).click();
      const organizer = await popup;
      await organizer.waitForLoadState();
      expect(organizer.url()).toBe('https://example.com/registration');
      expect(await organizer.evaluate(() => window.opener)).toBeNull();
      await organizer.close();

      // многодневный без ссылки — кнопки нет
      await page.goto(`/calendar/${multiDay.id}`);
      await expect(page.getByText(multiDay.title, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Регистрация у организатора' })).toHaveCount(0);

      // вкладка «Календарь» после входа: чип месяца года смоука → строки под подписью группы
      const rider = await registerHomeRider(request);
      await page.goto('/sign-in');
      await page.getByRole('textbox', { name: 'E-mail' }).fill(rider);
      await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/survey`);
      await page.getByRole('checkbox', { name: 'Календарь стартов' }).click();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await page.getByRole('button', { name: 'Не сейчас' }).click();
      await page.getByRole('button', { name: 'Позже' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/`);
      await page.getByRole('tab', { name: 'Календарь' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/calendar`);
      await expect(page.getByRole('heading', { name: 'Календарь стартов' })).toBeVisible();

      const monthChip = `Июнь ${HOME_FIXTURE_YEAR}`;
      const filtered = page.waitForRequest(
        (req) =>
          req.url().startsWith(`${API_URL}/v1/calendar?`) &&
          req.url().includes(`month=${HOME_FIXTURE_YEAR}-06`),
      );
      await page.getByRole('button', { name: monthChip, exact: true }).click();
      await filtered;
      await expect(
        page.getByRole('link', { name: new RegExp(`^Ближайший по фильтрам\\. ${start.title}\\.`) }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: monthChip, exact: true })).toBeVisible();

      // строка → карточка; «Назад» — во вкладку
      await page.getByRole('link', { name: new RegExp(`^${multiDay.title}\\. `) }).click();
      await expect(page).toHaveURL(`${BASE_URL}/calendar/${multiDay.id}`);
      await page.getByRole('button', { name: 'Назад' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/calendar`);
    } finally {
      await withdraw();
    }
  });
  test('Кофе-райды (блок 05): райдер создаёт райд формой, гость открывает ссылку (SSR, OG без ПДн, noindex), другой райдер «Я иду», отмена видна гостю', async ({
    page,
    request,
    browser,
  }) => {
    // ожидание кэша публичной карточки гостем (до 2 × 60 с)
    test.setTimeout(240_000);
    const organizer = await registerHomeRider(request);
    const title = `Смоук-райд ${Date.now()}`;
    let rideId: string | undefined;
    try {
      // A: форма «Новый райд» → карточка с баннером «опубликован»
      await signInRider(page, organizer);
      await page.getByRole('tab', { name: 'Райды' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/rides`);
      await page.getByRole('button', { name: 'Создать райд' }).first().click();
      await expect(page).toHaveURL(`${BASE_URL}/rides/new`);
      await page.getByRole('textbox', { name: 'Название' }).fill(title);
      await page.getByRole('textbox', { name: 'Как вас подписать' }).fill('Смоук');
      await page.getByLabel('Дата').fill(rideFixtureDate());
      await page.getByRole('textbox', { name: 'Время старта' }).fill('10:00');
      await page.getByRole('button', { name: 'Все города' }).click();
      await page.getByRole('button', { name: 'Минск', exact: true }).click();
      await page.getByRole('textbox', { name: 'Место старта' }).fill('Площадь смоука');
      await page.getByRole('textbox', { name: 'Дистанция, км' }).fill('42');
      await page.getByRole('textbox', { name: 'Темп от, км/ч' }).fill('22');
      await page.getByRole('textbox', { name: 'Темп до, км/ч' }).fill('24');
      await page.getByRole('textbox', { name: 'Максимум участников (необязательно)' }).fill('2');
      await page.getByRole('button', { name: 'Опубликовать' }).click();
      await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/rides/[0-9a-f-]{36}\\?published=1$`));
      rideId = new URL(page.url()).pathname.split('/').pop();
      await expect(
        card(page).getByText('Райд опубликован. Пригласите друзей ссылкой.'),
      ).toBeVisible();
      await expect(card(page).getByText('Кофе-райд · вы организатор')).toBeVisible();
      await expect(card(page).getByText('идёт 1 из 2 · вы')).toBeVisible();

      // вкладка «Райды»: райд виден (герой или строка)
      await page.goto('/rides');
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

      // гость: SSR карточки — название, OG без описания и ПДн, всегда noindex
      const html = await (await request.get(`/rides/${rideId}`)).text();
      expect(html).toContain(`<meta property="og:title" content="${title}"`);
      expect(html).toContain('Площадь смоука');
      expect(html).toMatch(/<meta name="robots" content="noindex"/);
      expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/rides/${rideId}"`);
      expect(html).not.toMatch(/@pokatim\.test|organizerUserId|participants/);
      const guest = await browser.newPage();
      await guest.goto(`${BASE_URL}/rides/${rideId}`);
      await expect(card(guest).getByText(title, { exact: true }).first()).toBeVisible();
      await expect(card(guest).getByRole('button', { name: 'Я иду' })).toBeVisible();

      // B: вход → карточка → «Я иду» → «Вы идёте · …», мест больше нет
      const rider = await registerHomeRider(request);
      const second = await browser.newPage();
      await signInRider(second, rider);
      await second.goto(`${BASE_URL}/rides/${rideId}`);
      await card(second).getByRole('button', { name: 'Я иду' }).click();
      await expect(card(second).getByText(/^Вы идёте · /)).toBeVisible();
      await expect(card(second).getByText('идут 2 из 2 · вы в списке')).toBeVisible();
      await second.close();

      // A отменяет с причиной → гость видит отмену
      await page.goto(`/rides/${rideId}`);
      await card(page).getByRole('button', { name: 'Отменить райд' }).click();
      await expect(page).toHaveURL(`${BASE_URL}/rides/cancel/${rideId}`);
      const cancel = page.getByTestId('ride-cancel');
      await cancel.getByRole('button', { name: 'плохая погода' }).click();
      await cancel.getByRole('button', { name: 'Отменить райд' }).click();
      await expect(card(page).getByText('Райд отменён. Причина: плохая погода.')).toBeVisible();
      // гость: публичная карточка кэшируется до 60 с (ответ API и SSR-кэш web-сервера, риск §8 task.md) — ждём
      // свежую выдачу перезагрузками; API без кэша уже отдаёт отмену
      const fresh = await (await request.get(`${API_URL}/v1/rides/${rideId}`)).json();
      expect(fresh).toMatchObject({ phase: 'cancelled', cancelReason: 'weather' });
      await expect(async () => {
        await guest.reload();
        await expect(card(guest).getByText('Райд отменён. Причина: плохая погода.')).toBeVisible({
          timeout: 2_000,
        });
      }).toPass({ timeout: 150_000, intervals: [10_000] });
      await expect(card(guest).getByRole('button', { name: 'Я иду' })).toHaveCount(0);
      await guest.close();
    } finally {
      if (rideId) await cancelRideByApi(request, organizer, rideId);
    }
  });
});
