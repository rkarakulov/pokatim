import { type APIRequestContext, expect } from '@playwright/test';

/** HTTP API Mailpit (письма подтверждения регистрации). */
const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025').replace(/\/$/, '');

interface MailpitSearch {
  messages: { ID: string }[];
}

/** Токен из ссылки подтверждения `…/auth/verify/<token>` последнего письма адресату (ждём письмо, не паузу). */
export async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const query = `to:"${email}" subject:"Подтвердите e-mail"`;
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query } });
        id = ((await response.json()) as MailpitSearch).messages[0]?.ID;
        return id;
      },
      { message: `письмо ${query} в Mailpit`, timeout: 30_000 },
    )
    .toBeDefined();
  const message = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as {
    Text: string;
  };
  const token = /\/auth\/verify\/([\w-]+)/.exec(message.Text)?.[1];
  expect(token, 'ссылка подтверждения в письме').toBeDefined();
  return token ?? '';
}
