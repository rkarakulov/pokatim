/// <reference types="jest" />
import { INVITE_KEY, INVITE_TTL_MS } from './invite-state';
import { forgetInvite, rememberInvite, takeInvite } from './invite-storage';

const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const NOW = Date.parse('2026-10-31T10:00:00Z');
const MINUTE = 60_000;

describe('код приглашения (native, P6)', () => {
  it('сохраняет код в верхнем регистре; последний код перекрывает прежний', async () => {
    await rememberInvite('k7m2pqx', NOW);
    await rememberInvite('Z9Z9Z9Z', NOW + MINUTE);
    expect(JSON.parse(store().get(INVITE_KEY) ?? '{}')).toEqual({
      code: 'Z9Z9Z9Z',
      at: NOW + MINUTE,
    });
    await expect(takeInvite(NOW + 2 * MINUTE)).resolves.toBe('Z9Z9Z9Z');
  });

  it('7 дней — отдаёт; 7 дней и 1 минуту — null и стёрт (AC5)', async () => {
    await rememberInvite('K7M2PQX', NOW);
    await expect(takeInvite(NOW + INVITE_TTL_MS)).resolves.toBe('K7M2PQX');
    await expect(takeInvite(NOW + INVITE_TTL_MS + MINUTE)).resolves.toBeNull();
    expect(store().has(INVITE_KEY)).toBe(false);
  });

  it('мусор из ссылки не пишется и не перекрывает валидный', async () => {
    await rememberInvite('K7M2PQX', NOW);
    for (const junk of ['K7M2PQ0', '', 42, null, ['K7M2PQX']]) await rememberInvite(junk, NOW + 1);
    await expect(takeInvite(NOW + 2)).resolves.toBe('K7M2PQX');
  });

  it('битая запись — null и стёрта; forgetInvite стирает', async () => {
    store().set(INVITE_KEY, '{"code":"bad","at":1}');
    await expect(takeInvite(NOW)).resolves.toBeNull();
    expect(store().has(INVITE_KEY)).toBe(false);
    await rememberInvite('K7M2PQX', NOW);
    await forgetInvite();
    await expect(takeInvite(NOW)).resolves.toBeNull();
  });
});
