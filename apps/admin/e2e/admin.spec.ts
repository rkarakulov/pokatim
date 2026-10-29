import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

import { verificationToken } from './mailpit';
import { API_URL, apiEnv, ORIGIN } from './project';

// Смоук панели (AC15): два пользователя приложения → CLI grant-admin первому → вход в панель → «Сотрудники» → роль
// moderator второму → вход второго (журнал виден, «Сотрудники» по URL — «Нет доступа к разделу») → первый снимает
// роль с причиной → следующий запрос второго — «Сессия истекла», повторный вход — «Нет доступа к панели» → журнал
// содержит записи. Ошибки страницы — пусто, кроме согласованных 401/403 API панели; страница — под CSP панели
// (vite preview отдаёт тот же заголовок, что nginx admin), нарушение CSP — ошибка консоли.

const PASSWORD = 'e2e-long-enough';
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));

/** Согласованные отказы загрузки: «кто я» без сессии, вход без роли, запрос после снятия роли. */
const EXPECTED = [
  { url: `${ORIGIN}/v1/admin/session/me`, status: 401 },
  { url: `${ORIGIN}/v1/admin/session/sign-in`, status: 403 },
  { url: /^http:\/\/localhost:\d+\/v1\/admin\/audit(\?.*)?$/, status: 401 },
];
const RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of (\d{3})/;

function watchErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    const status = Number(RESOURCE_ERROR.exec(message.text())?.[1]);
    const expected = EXPECTED.some(
      (item) =>
        item.status === status &&
        (typeof item.url === 'string' ? item.url === url : item.url.test(url)),
    );
    if (!expected) errors.push(`console: ${message.text()} @ ${url}`);
  });
}

/** Пользователь приложения с подтверждённым e-mail: регистрация через API → письмо (Mailpit) → подтверждение. */
async function verifiedUser(request: APIRequestContext, email: string) {
  const registered = await request.post(`${API_URL}/v1/auth/register`, {
    data: { email, password: PASSWORD, birthDate: '1990-05-01', personalDataConsent: true },
  });
  expect(registered.status()).toBe(201);
  const token = await verificationToken(request, email);
  const confirmed = await request.post(`${API_URL}/v1/auth/verification/confirm`, {
    data: { token },
  });
  expect(confirmed.status()).toBe(200);
}

async function openPanel(browser: Browser, errors: string[]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  watchErrors(page, errors);
  return page;
}

async function signIn(page: Page, email: string) {
  await expect(page.getByRole('heading', { name: 'Вход в панель' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
}

test('панель: CLI → вход → выдача и снятие роли → сессия гаснет → журнал (AC15)', async ({
  browser,
  request,
}) => {
  const run = Date.now();
  const adminEmail = `panel-admin-${run}@example.test`;
  const modEmail = `panel-mod-${run}@example.test`;
  const errors: string[] = [];

  await verifiedUser(request, adminEmail);
  await verifiedUser(request, modEmail);
  const cli = execFileSync(
    'node',
    ['dist/cli/panel.js', 'grant-admin', '--email', adminEmail, '--name', 'Ольга'],
    { cwd: API_DIR, env: apiEnv, encoding: 'utf8' },
  );
  expect(cli).toContain('выдана');
  expect(cli).not.toContain(adminEmail);

  // администратор: вход и «Сотрудники»
  const admin = await openPanel(browser, errors);
  const panelResponse = await admin.goto('/admin/');
  expect(panelResponse?.headers()['content-security-policy']).toContain("script-src 'self'");
  await signIn(admin, adminEmail);
  await expect(admin.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  await expect(admin.getByText('Ольга · Администратор · команда платформы')).toBeVisible();
  await admin.getByRole('link', { name: 'Сотрудники' }).click();
  await expect(admin.getByRole('heading', { name: 'Сотрудники' })).toBeVisible();

  await admin.getByRole('button', { name: 'Выдать роль' }).click();
  const grant = admin.getByRole('dialog');
  await grant.getByLabel('E-mail пользователя').fill(modEmail);
  await grant.getByLabel('Имя в панели').fill('Мария');
  await grant.getByLabel('Роль').selectOption('moderator');
  await grant.getByRole('button', { name: 'Выдать роль' }).click();
  await expect(grant).toBeHidden();
  const modRow = admin.getByRole('row').filter({ hasText: modEmail });
  await expect(modRow).toContainText('Модератор');

  // модератор: журнал виден, «Сотрудники» по URL — нет доступа
  const moderator = await openPanel(browser, errors);
  await moderator.goto('/admin/');
  await signIn(moderator, modEmail);
  await expect(moderator.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  const nav = moderator.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Журнал действий' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Сотрудники' })).toHaveCount(0);
  await moderator.goto('/admin/members');
  await expect(moderator.getByRole('heading', { name: 'Нет доступа к разделу' })).toBeVisible();
  await moderator.getByRole('link', { name: 'Журнал действий' }).click();
  await expect(moderator.getByRole('heading', { name: 'Журнал действий' })).toBeVisible();
  await expect(moderator.getByRole('table')).toContainText('Выдана роль');

  // администратор снимает роль с причиной
  await modRow.getByRole('button', { name: 'Снять роль: Мария' }).click();
  const revoke = admin.getByRole('dialog');
  await revoke.getByLabel('Причина (обязательно)').fill('ротация команды');
  await revoke.getByRole('button', { name: 'Снять роль' }).click();
  await expect(revoke).toBeHidden();
  await expect(modRow).toContainText('Роль снята');

  // следующий запрос модератора («Обзор» — `GET /v1/admin/overview`) — «Сессия истекла»; повторный вход — «Нет доступа
  // к панели»
  await moderator.getByRole('link', { name: 'Обзор' }).click();
  await expect(moderator.getByText('Сессия истекла')).toBeVisible();
  await signIn(moderator, modEmail);
  await expect(moderator.getByRole('heading', { name: 'Нет доступа к панели' })).toBeVisible();
  await expect(
    moderator.getByText(`Аккаунт ${modEmail} не входит в команду платформы.`, { exact: false }),
  ).toBeVisible();

  // журнал администратора
  await admin.getByRole('link', { name: 'Журнал действий' }).click();
  const journal = admin.getByRole('table');
  await expect(journal).toContainText('Снята роль: Модератор');
  await expect(journal).toContainText('ротация команды');
  await expect(journal).toContainText('Выдана роль: Модератор');
  await expect(journal).toContainText('Вход в панель');
  await expect(journal).toContainText('Сервер (CLI)');
  await expect(journal).not.toContainText(modEmail);

  expect(errors).toEqual([]);
});
