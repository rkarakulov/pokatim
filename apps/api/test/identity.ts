import { OUTBOX_COLLECTION, type MongoOutboxDoc } from '@rkarakulov/api-kit/mongo';
import type { ClientSession } from 'mongodb';
import { onTestFinished, vi } from 'vitest';

import { identityCollections } from '../src/modules/identity/identity.collection';
import { derivePasswordResetToken, deriveVerificationToken } from '../src/modules/identity/tokens';
import type { Harness } from './harness';

/** Коллекции identity тестовой БД стенда. */
export const collections = (h: Harness) => identityCollections(h.db);

/** События outbox по порядку записи. */
export const outboxEvents = (h: Harness) =>
  h.db
    .collection<MongoOutboxDoc>(OUTBOX_COLLECTION)
    .find()
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

/** id пользователя по e-mail (тест знает, что он есть). */
export async function userIdByEmail(h: Harness, email = 'rider@example.com'): Promise<string> {
  const user = await collections(h).users.findOne({ email });
  if (!user) throw new Error('no user');
  return user._id;
}

export const validRegistration = (overrides: Record<string, unknown> = {}) => ({
  email: 'rider@example.com',
  password: 'long-enough',
  birthDate: '1990-05-01',
  personalDataConsent: true,
  ...overrides,
});

export interface CallResult {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}

export async function call(
  h: Harness,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<CallResult> {
  const response = await h.app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  const text = response.body;
  return {
    status: response.statusCode,
    body: text ? (JSON.parse(text) as unknown) : undefined,
    headers: response.headers,
  };
}

export const register = (h: Harness, overrides: Record<string, unknown> = {}) =>
  call(h, 'POST', '/v1/auth/register', validRegistration(overrides));

/** Токен действующей ссылки пользователя — тот же, что окажется в письме (HMAC от id строки). */
export async function activeLinkToken(h: Harness, email = 'rider@example.com'): Promise<string> {
  const userId = await userIdByEmail(h, email);
  const link = await collections(h).emailVerificationTokens.findOne(
    { userId, supersededAt: null, usedAt: null },
    { sort: { createdAt: -1 } },
  );
  if (!link) throw new Error('no active verification token');
  return deriveVerificationToken(h.env.EMAIL_TOKEN_SECRET, link._id);
}

export const confirm = (h: Harness, token: string) =>
  call(h, 'POST', '/v1/auth/verification/confirm', { token });

export const poll = (h: Harness, registrationToken: string, sessionTransport?: 'body' | 'cookie') =>
  call(h, 'POST', '/v1/auth/registration/poll', {
    registrationToken,
    ...(sessionTransport ? { sessionTransport } : {}),
  });

export const resend = (h: Harness, body: Record<string, string>) =>
  call(h, 'POST', '/v1/auth/verification/resend', body);

/** Запрос ссылки сброса «с IP клиента» (за прокси — при `TRUST_PROXY=1`). */
export const requestPasswordReset = (h: Harness, email: string, ip = '198.51.100.1') =>
  call(h, 'POST', '/v1/auth/password-reset', { email }, { 'x-forwarded-for': ip });

export const describePasswordReset = (h: Harness, token: string) =>
  call(h, 'GET', `/v1/auth/password-reset/${token}`);

export const confirmPasswordReset = (h: Harness, token: string, password: string) =>
  call(h, 'POST', '/v1/auth/password-reset/confirm', { token, password });

/** Токен последней ссылки сброса пользователя — тот же, что окажется в письме (HMAC от id строки). */
export async function latestResetToken(h: Harness, email = 'rider@example.com'): Promise<string> {
  const userId = await userIdByEmail(h, email);
  const link = await collections(h).passwordResetTokens.findOne(
    { userId },
    { sort: { createdAt: -1, _id: -1 } },
  );
  if (!link) throw new Error('no password reset token');
  return derivePasswordResetToken(h.env.EMAIL_TOKEN_SECRET, link._id);
}

// --- гонки без блокировок строк (R9, `pokatim-tests.md`) ---

/** Ворота: операция под spy ждёт `open()`; `reached` — операция дошла до ворот. */
export function gate() {
  let open!: () => void;
  let reach!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return { open, reached, wait: () => (reach(), opened) };
}

/**
 * Удерживаемая транзакция — «другая транзакция аккаунта уже записала документ, но не закоммитила»: `write` выполняется в открытой
 * транзакции (как `MongoTransactions`: snapshot + majority), коммит — по команде теста. Пока она открыта, другая
 * транзакция, пишущая те же документы, получает конфликт записи и повторяется, а запись вне транзакции ждёт.
 */
export async function holdTransaction(
  h: Harness,
  write: (session: ClientSession) => Promise<void>,
) {
  const session = h.client.startSession();
  session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  let open = true;
  const finish = async (action: 'commitTransaction' | 'abortTransaction') => {
    if (!open) return;
    open = false;
    try {
      await session[action]();
    } finally {
      await session.endSession();
    }
  };
  // упавший тест не оставляет транзакцию открытой: она держала бы документы до transactionLifetimeLimitSeconds
  onTestFinished(() => finish('abortTransaction'));
  try {
    await write(session);
  } catch (error) {
    await finish('abortTransaction');
    throw error;
  }
  return { commit: () => finish('commitTransaction'), abort: () => finish('abortTransaction') };
}

/**
 * Ждёт, пока операция упрётся в удерживаемую транзакцию: `retried` — повтор транзакции (spy `lockUser*` и т. п.
 * вызван ≥ 2 раз) или ожидание записи вне транзакции. Если операция уже завершилась (механизм убран — отрицательное
 * доказательство), ожидание заканчивается сразу, и тест проверяет её результат.
 */
export async function untilBlocked(operation: Promise<unknown>, blocked: () => Promise<boolean>) {
  let settled = false;
  void operation.then(
    () => (settled = true),
    () => (settled = true),
  );
  await vi.waitFor(
    async () => {
      if (!settled && !(await blocked())) throw new Error('операция ещё не упёрлась в транзакцию');
    },
    { timeout: 5_000, interval: 5 },
  );
}

/** Транзакция под spy повторилась (конфликт записи). */
export const retried = (spy: { mock: { calls: unknown[] } }) => (): Promise<boolean> =>
  Promise.resolve(spy.mock.calls.length >= 2);

/**
 * Запись вне транзакции над `collection` выполняется и ждёт удерживаемую транзакцию — аналог `waitForLockWaiter`:
 * удерживающая транзакция простаивает и в `$currentOp` без `idleSessions` не видна.
 */
export const writeWaiting = (h: Harness, collection: string) => async (): Promise<boolean> => {
  const ns = `${h.db.databaseName}.${collection}`;
  const ops = await h.client
    .db('admin')
    .aggregate([
      { $currentOp: { allUsers: true, idleSessions: false } },
      { $match: { ns, active: true, op: { $in: ['update', 'command', 'remove'] } } },
    ])
    .toArray();
  return ops.length > 0;
};
