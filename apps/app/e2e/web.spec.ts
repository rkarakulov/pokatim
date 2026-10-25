import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { latestMailText, passwordResetLink, verificationLink } from './mailpit';
import { REFRESH_URL, SIGN_IN_URL } from './project';
import { API_URL, BASE_URL, DEV_URL, WITH_API } from './urls';

// Смоук web-версии pokatim: SSR → гидрация → гард сессии, публичные экраны с OG, витрина (dev), PWA;
// с API (E2E_API=1) — регистрация → письмо → подтверждение → вход → вход переживает перезагрузку (cookie) →
// выход → вход по паролю (неверный пароль — баннер) → перезагрузка → выход → «Забыли пароль?» → письмо → новый пароль
// → старый пароль не подходит → вход новым → письмо «Пароль изменён».
// Ошибки страницы (исключения, рассинхрон гидрации, неожиданные отказы загрузки) проверяет фикстура (fixtures.ts);
// ожидаемый 401 восстановления сессии анонима — в e2e/project.ts.

/** Cookie refresh web-сессии — как задано (task.md F5b §7), а не импорт из contracts: смоук проверяет ответ API. */
const SESSION_COOKIE = { name: '__Secure-pokatim_rt', path: '/v1/auth/session' };

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

test('витрина /ui-kit: в production — Главная гостя', async ({ page }) => {
  await page.goto('/ui-kit');
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

  test('регистрация → письмо → подтверждение → вход; вход переживает перезагрузку (cookie)', async ({
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
    await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

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
    await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

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
    await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE.name);

    // и вход по паролю переживает перезагрузку
    const restored = page.waitForResponse(REFRESH_URL);
    await page.reload();
    expect((await restored).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

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
    await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

    // уведомление о смене пароля — без ссылки с токеном
    const changed = await latestMailText(request, `to:"${email}" subject:"Пароль изменён"`);
    expect(changed).toContain('по минскому времени');
    expect(changed).not.toMatch(/auth\/reset/);
  });
});
