import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { invitationLink, verificationToken } from './mailpit';
import { API_URL, apiEnv, ORIGIN, PANEL_URL } from './project';

// Смоук приглашения в команду (ADR-0026): CLI grant-admin → вход админа → «Пригласить» адрес без аккаунта → письмо
// (worker → Mailpit) со ссылкой на панель → приглашённый регистрируется в приложении на этот адрес → ссылка → «Принять
// и войти» своим паролем → «Обзор» с ролью; у админа — сотрудник в списке, приглашения больше нет. Ошибки страницы —
// только согласованный 401 «кто я» без сессии.

const PASSWORD = 'e2e-long-enough';
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));
const RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of (\d{3})/;
const EXPECTED = [{ url: `${ORIGIN}/v1/admin/session/me`, status: 401 }];

function watchErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    const status = Number(RESOURCE_ERROR.exec(message.text())?.[1]);
    if (EXPECTED.some((item) => item.status === status && item.url === url)) return;
    errors.push(`console: ${message.text()} @ ${url}`);
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

test('приглашение: письмо → регистрация в приложении → принятие паролем → «Обзор» (ADR-0026)', async ({
  browser,
  request,
}) => {
  const run = Date.now();
  const adminEmail = `invite-admin-${run}@example.test`;
  const inviteeEmail = `invitee-${run}@example.test`;
  const errors: string[] = [];

  await verifiedUser(request, adminEmail);
  execFileSync(
    'node',
    ['dist/cli/panel.js', 'grant-admin', '--email', adminEmail, '--name', 'Ольга'],
    { cwd: API_DIR, env: apiEnv, encoding: 'utf8' },
  );

  // администратор приглашает адрес, у которого ещё нет аккаунта
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  watchErrors(admin, errors);
  await admin.goto('/admin/');
  await admin.getByLabel('E-mail').fill(adminEmail);
  await admin.getByLabel('Пароль').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Войти' }).click();
  await expect(admin.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  await admin.getByRole('link', { name: 'Сотрудники' }).click();
  await admin.getByRole('button', { name: 'Пригласить', exact: true }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog).toContainText('Ссылка действует 7 дней.');
  await dialog.getByLabel('E-mail').fill(inviteeEmail);
  await dialog.getByLabel('Имя в панели').fill('Мария');
  await dialog.getByLabel('Роль').selectOption('moderator');
  await dialog.getByRole('button', { name: 'Отправить приглашение' }).click();
  await expect(dialog).toBeHidden();
  await expect(admin.getByRole('row').filter({ hasText: inviteeEmail })).toBeVisible();

  // письмо → регистрация в приложении на тот же адрес → ссылка на панель
  const link = await invitationLink(request, inviteeEmail);
  expect(link.startsWith(`${PANEL_URL}invite#token=`)).toBe(true);
  await verifiedUser(request, inviteeEmail);

  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  watchErrors(invitee, errors);
  await invitee.goto(link);
  await expect(invitee.getByRole('heading', { name: 'Приглашение в команду' })).toBeVisible();
  // токен убран из адреса (history.replaceState)
  expect(invitee.url()).not.toContain('token=');
  await invitee.getByLabel('E-mail').fill(inviteeEmail);
  await invitee.getByLabel('Пароль').fill(PASSWORD);
  await invitee.getByRole('button', { name: 'Принять и войти' }).click();
  await expect(invitee.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  await expect(invitee.getByText('Мария · Модератор', { exact: false })).toBeVisible();

  // у администратора: сотрудник в списке, приглашение закрыто
  await admin.reload();
  await expect(admin.getByRole('row').filter({ hasText: inviteeEmail })).toContainText('Модератор');
  await expect(
    admin.getByRole('button', { name: `Отправить повторно: ${inviteeEmail}` }),
  ).toHaveCount(0);

  await Promise.all([adminContext.close(), inviteeContext.close()]);
  expect(errors).toEqual([]);
});
