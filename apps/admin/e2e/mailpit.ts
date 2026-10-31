import { type APIRequestContext, expect } from '@playwright/test';

/** HTTP API Mailpit (письма подтверждения регистрации, приглашения в команду). */
const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025').replace(/\/$/, '');

interface MailpitSearch {
  messages: { ID: string }[];
}

/** Текст последнего письма по запросу поиска Mailpit (ждём письмо, не паузу). */
async function lastMessageText(request: APIRequestContext, query: string): Promise<string> {
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
  return message.Text;
}

/** Токен из ссылки подтверждения `…/auth/verify/<token>` последнего письма адресату. */
export async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const text = await lastMessageText(request, `to:"${email}" subject:"Подтвердите e-mail"`);
  const token = /\/auth\/verify\/([\w-]+)/.exec(text)?.[1];
  expect(token, 'ссылка подтверждения в письме').toBeDefined();
  return token ?? '';
}

/** Ссылка `…/admin/invite#token=…` последнего письма-приглашения адресату (ADR-0026). */
export async function invitationLink(request: APIRequestContext, email: string): Promise<string> {
  const text = await lastMessageText(request, `to:"${email}" subject:"Приглашение в команду"`);
  const link = /Принять приглашение: (\S+invite#token=[\w-]+)/.exec(text)?.[1];
  expect(link, 'ссылка приглашения в письме').toBeDefined();
  return link ?? '';
}
