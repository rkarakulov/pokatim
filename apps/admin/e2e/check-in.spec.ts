import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { verificationToken } from './mailpit';
import { API_URL, apiEnv, ORIGIN, PANEL_URL } from './project';

// Смоук «Check-in» (event-tickets PR C): CLI grant-admin → вход → пункт «Check-in» → экран без сайдбара под CSP и
// Permissions-Policy панели (камера — только свой origin) → ручной ввод неизвестного кода → «Билет не найден…»
// (согласованный 404 lookup). Камеру CI не запрашивает. Ошибки страницы — только согласованные 401 и 404.

const PASSWORD = 'e2e-long-enough';
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));
const RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of (\d{3})/;
const EXPECTED = [
  { url: `${ORIGIN}/v1/admin/session/me`, status: 401 },
  { url: `${ORIGIN}/v1/admin/tickets/lookup`, status: 404 },
];

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

test('check-in: экран без сайдбара под Permissions-Policy, неизвестный код — «не найден»', async ({
  browser,
  request,
}) => {
  const email = `checkin-admin-${Date.now()}@example.test`;
  const errors: string[] = [];
  await verifiedUser(request, email);
  execFileSync('node', ['dist/cli/panel.js', 'grant-admin', '--email', email, '--name', 'Ольга'], {
    cwd: API_DIR,
    env: apiEnv,
    encoding: 'utf8',
  });

  const page = await (await browser.newContext()).newPage();
  watchErrors(page, errors);
  await page.goto('/admin/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();

  await page.getByRole('link', { name: 'Check-in' }).click();
  await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Включить камеру' })).toBeVisible();

  // заголовки документа панели — как у nginx образа admin (vite preview читает тот же конфиг)
  const document = await request.get(`${PANEL_URL}check-in`);
  expect(document.headers()['permissions-policy']).toContain('camera=(self)');
  expect(document.headers()['content-security-policy']).toContain("script-src 'self'");

  await page.getByRole('textbox', { name: 'Код билета' }).fill('00000-00000');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByText('Билет не найден или событие недоступно')).toBeVisible();
  expect(errors).toEqual([]);
});
