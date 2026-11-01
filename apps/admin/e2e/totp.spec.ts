import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

import { verificationToken } from './mailpit';
import { API_URL, apiEnv, ORIGIN } from './project';

// Смоук 2FA панели (ADR-0024, panel-2fa §8.2 п.10): CLI grant-admin → вход паролем → «Безопасность» → «Подключить» →
// ключ со страницы подключения → код TOTP считает сам тест (RFC 6238: SHA-1, 30 с, 6 цифр) → коды восстановления →
// «Выйти» → вход паролем и кодом → «Обзор». Ключ `PANEL_TOTP_KEY` смоука — фиктивный (`project.ts`). Секрет и коды
// в вывод не попадают: проверки — без значений в сообщениях. Ошибки страницы — только 401 «кто я» без сессии.

const PASSWORD = 'e2e-long-enough';
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url));
const RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of (\d{3})/;
const EXPECTED = [{ url: `${ORIGIN}/v1/admin/session/me`, status: 401 }];
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SEC = 30;

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

/** base32 RFC 4648 (ключ ручного ввода, группы по 4 через пробел) → байты секрета. */
function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('ключ подключения: не base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const totpStep = () => Math.floor(Date.now() / 1000 / PERIOD_SEC);

/** HOTP(secret, step) RFC 4226: HMAC-SHA-1, динамическое усечение, 6 цифр. */
function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
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

async function signInWithPassword(page: Page, email: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
}

test('2FA: подключение в «Безопасности» → выход → вход паролем и кодом (ADR-0024)', async ({
  browser,
  request,
}) => {
  const email = `totp-admin-${Date.now()}@example.test`;
  const errors: string[] = [];

  await verifiedUser(request, email);
  execFileSync('node', ['dist/cli/panel.js', 'grant-admin', '--email', email, '--name', 'Ольга'], {
    cwd: API_DIR,
    env: apiEnv,
    encoding: 'utf8',
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  watchErrors(page, errors);
  await page.goto('/admin/');
  await signInWithPassword(page, email);
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();

  // подключение: ключ ручного ввода со страницы, первый код — текущего шага
  await page.getByRole('link', { name: 'Безопасность', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Безопасность' })).toBeVisible();
  await expect(page.getByText('Не подключена')).toBeVisible();
  await page.getByRole('button', { name: 'Подключить' }).click();
  const key = page.locator('.totp-enroll__secret code');
  await expect(key).toBeVisible();
  const secret = base32Decode(await key.innerText());
  // 160 бит (RFC 4226); значение в сообщение проверки не попадает
  expect(secret.length === 20).toBe(true);
  const enrolledStep = totpStep();
  await page.getByLabel('Код из приложения').fill(totpCode(secret, enrolledStep));
  await page.getByRole('button', { name: 'Подключить' }).click();

  // коды восстановления → «Готово» → статус «Подключена …»
  await expect(page.getByRole('list', { name: 'Коды восстановления' })).toBeVisible();
  await page.getByLabel('Я сохранил коды').check();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByText(/^Подключена /)).toBeVisible();

  // выход → пароль → шаг кода (без «Запомнить устройство»)
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel('Пароль')).toBeVisible();
  await signInWithPassword(page, email);
  await expect(page.getByRole('heading', { name: 'Подтверждение входа' })).toBeVisible();
  // повтор принятого шага закрыт (`lastUsedStep`): код следующего шага — в окне ±1 шаг сервера
  await page.getByLabel('Код из приложения').fill(totpCode(secret, enrolledStep + 1));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();

  await context.close();
  expect(errors).toEqual([]);
});
