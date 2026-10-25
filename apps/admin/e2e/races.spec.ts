import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

import { verificationToken } from './mailpit';
import { API_URL, apiEnv, ORIGIN } from './project';

// Смоук сезонов и гонок (admin-02 AC15): CLI grant-admin первому → админ выдаёт organizer второму → админ создаёт
// сезон → организатор создаёт и публикует гонку → публичный `GET /v1/races` её видит → админ отменяет с шаблонной
// причиной → «Журнал действий» содержит сезон и гонку. Ошибки страницы — только согласованный 401 «кто я».
// Даты — далёкий год, свой на каждый прогон: сезоны dev-БД не пересекаются с прошлыми прогонами.

const PASSWORD = 'e2e-long-enough';
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));
const RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of (\d{3})/;

function watchErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    const status = Number(RESOURCE_ERROR.exec(message.text())?.[1]);
    // «кто я» без сессии перед входом — ожидаемый 401
    if (status === 401 && url === `${ORIGIN}/v1/admin/session/me`) return;
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

async function openPanel(browser: Browser, errors: string[], email: string) {
  const page = await (await browser.newContext()).newPage();
  watchErrors(page, errors);
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Вход в панель' })).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
  return page;
}

test('сезон → гонка организатора → публикация → GET /v1/races → отмена → журнал (AC15)', async ({
  browser,
  request,
}) => {
  const run = Date.now();
  const year = 3000 + (run % 5000);
  const adminEmail = `races-admin-${run}@example.test`;
  const orgEmail = `races-org-${run}@example.test`;
  const seasonName = `Сезон ${year}`;
  const raceTitle = `Коридор e2e ${run}`;
  const errors: string[] = [];

  await verifiedUser(request, adminEmail);
  await verifiedUser(request, orgEmail);
  execFileSync(
    'node',
    ['dist/cli/panel.js', 'grant-admin', '--email', adminEmail, '--name', 'Ольга'],
    { cwd: API_DIR, env: apiEnv, encoding: 'utf8' },
  );

  // админ выдаёт роль организатора второму
  const admin = await openPanel(browser, errors, adminEmail);
  await admin.getByRole('link', { name: 'Сотрудники' }).click();
  await admin.getByRole('button', { name: 'Выдать роль' }).click();
  const grant = admin.getByRole('dialog');
  await grant.getByLabel('E-mail пользователя').fill(orgEmail);
  await grant.getByLabel('Имя в панели').fill('Ира');
  await grant.getByLabel('Роль').selectOption('organizer');
  await grant.getByRole('button', { name: 'Выдать роль' }).click();
  await expect(grant).toBeHidden();

  // админ создаёт сезон
  await admin.getByRole('link', { name: 'Сезоны' }).click();
  const seasonForm = admin.getByRole('form', { name: 'Новый сезон' });
  await seasonForm.getByLabel('Название').fill(seasonName);
  await seasonForm.getByLabel(/^Начало/).fill(`${year}-01-01`);
  await seasonForm.getByLabel(/^Конец/).fill(`${year}-12-31`);
  await seasonForm.getByRole('button', { name: 'Создать сезон' }).click();
  await expect(admin.getByRole('row').filter({ hasText: seasonName })).toContainText('Предстоящий');

  // организатор создаёт и публикует гонку
  const org = await openPanel(browser, errors, orgEmail);
  const nav = org.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Календарь' })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Гонки' }).click();
  await org.getByRole('link', { name: 'Новая гонка' }).click();
  await org.getByLabel('Название').fill(raceTitle);
  await org.getByRole('button', { name: 'Гравий' }).click();
  await org.getByLabel('Дистанция, км').fill('64,5');
  await org.getByLabel(/^Окно: начало/).fill(`${year}-06-01T00:00`);
  await org.getByLabel(/^Окно: конец/).fill(`${year}-06-03T23:59`);
  await expect(org.getByRole('status', { name: 'Сезон (по концу окна)' })).toContainText(
    seasonName,
  );
  await org.getByLabel(/^Плановая дата протокола/).fill(`${year}-06-05T23:59`);
  await org.getByRole('button', { name: 'Создать гонку' }).click();
  await expect(org.getByRole('heading', { name: raceTitle, level: 1 })).toBeVisible();
  const raceId = /\/races\/([0-9a-f-]{36})$/.exec(org.url())?.[1];
  expect(raceId).toBeDefined();
  await org.getByRole('button', { name: 'Опубликовать' }).click();
  await org.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click();
  await expect(org.getByText(/^Скоро · протокол по плану/)).toBeVisible();

  // публичное чтение видит гонку (без входа)
  const list = await request.get(`${API_URL}/v1/races`, {
    params: { month: `${year}-06` },
  });
  expect(list.status()).toBe(200);
  expect(list.headers()['cache-control']).toBe('public, max-age=60');
  const page = (await list.json()) as { items: { id: string; title: string; phase: string }[] };
  expect(page.items).toContainEqual(
    expect.objectContaining({ id: raceId, title: raceTitle, phase: 'upcoming' }),
  );

  // админ отменяет с шаблонной причиной
  await admin.getByRole('link', { name: 'Гонки' }).click();
  await admin.getByRole('link', { name: raceTitle }).click();
  await admin.getByRole('button', { name: 'Отменить гонку' }).click();
  const cancel = admin.getByRole('dialog');
  await expect(cancel.getByRole('radio').first()).toBeFocused();
  await cancel.getByRole('radio', { name: 'Неблагоприятные погодные условия' }).check();
  await expect(cancel).toContainText('Участники увидят «Гонка отменена. Причина: неблагоприятные');
  await cancel.getByRole('button', { name: 'Отменить гонку' }).click();
  await expect(cancel).toBeHidden();
  await expect(admin.getByText('Гонка отменена — только чтение.')).toBeVisible();

  // журнал: сезон и гонка с объектами
  await admin.getByRole('link', { name: 'Журнал действий' }).click();
  const journal = admin.getByRole('table');
  await expect(journal).toContainText('Отменена гонка: Неблагоприятные погодные условия');
  await expect(journal).toContainText('Опубликована гонка');
  await expect(journal).toContainText('Создана гонка');
  await expect(journal).toContainText('Создан сезон');
  await expect(journal).toContainText(seasonName);
  await expect(journal).toContainText(raceTitle);

  expect(errors).toEqual([]);
});
