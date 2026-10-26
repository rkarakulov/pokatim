import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { HOME_FIXTURE_PASSWORD } from './schedule-fixture';
import { API_URL, BASE_URL } from './urls';

// Кофе-райды смоука (блок 05): райдеры прогона — свои e-mail; райд — через форму приложения в ближайшие дни
// (окно сервера — до +60 дней), после проверки отменяется через API (виден только участникам смоука). Запросы из
// Node — как native (сессия в теле ответа входа).

/** Дата старта райда смоука — через неделю по Минску, `YYYY-MM-DD`. */
export const rideFixtureDate = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Minsk' }).format(
    new Date(Date.now() + 7 * 86_400_000),
  );

/** Вход райдера в приложение и онбординг (опрос, геопозиция «Не сейчас», устройства «Позже») → Главная. */
export async function signInRider(page: Page, email: string) {
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByRole('textbox', { name: 'E-mail' }).fill(email);
  await page.getByRole('textbox', { name: 'Пароль' }).fill(HOME_FIXTURE_PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/survey`);
  await page.getByRole('checkbox', { name: 'Календарь стартов' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Не сейчас' }).click();
  await page.getByRole('button', { name: 'Позже' }).click();
  await expect(page).toHaveURL(`${BASE_URL}/`);
}

/** Отмена райда организатором через API (уборка смоука; уже отменённый — идемпотентно 200). */
export async function cancelRideByApi(request: APIRequestContext, email: string, id: string) {
  const signIn = await request.post(`${API_URL}/v1/auth/session/sign-in`, {
    data: { email, password: HOME_FIXTURE_PASSWORD },
  });
  expect(signIn.status()).toBe(200);
  const body = (await signIn.json()) as { session?: { accessToken: string } };
  const token = body.session?.accessToken;
  expect(token, 'access райдера смоука').toBeDefined();
  const cancelled = await request.post(`${API_URL}/v1/rides/${id}/cancel`, {
    headers: { authorization: `Bearer ${token}` },
    data: { reason: 'other' },
  });
  expect([200, 404]).toContain(cancelled.status());
}
