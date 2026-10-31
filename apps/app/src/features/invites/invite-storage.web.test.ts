/// <reference types="jest" />
import { INVITE_KEY, INVITE_TTL_MS } from './invite-state';
import { forgetInvite, rememberInvite, takeInvite } from './invite-storage';

const NOW = Date.parse('2026-10-31T10:00:00Z');
const MINUTE = 60_000;

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('код приглашения (web, P6)', () => {
  it('в localStorage; последний код перекрывает прежний', async () => {
    await rememberInvite('k7m2pqx', NOW);
    await rememberInvite('Z9Z9Z9Z', NOW + MINUTE);
    expect(JSON.parse(localStorage.getItem(INVITE_KEY) ?? '{}')).toEqual({
      code: 'Z9Z9Z9Z',
      at: NOW + MINUTE,
    });
    await expect(takeInvite(NOW + MINUTE)).resolves.toBe('Z9Z9Z9Z');
  });

  it('7 дней — отдаёт; 7 дней и 1 минуту — null и стёрт (AC5)', async () => {
    await rememberInvite('K7M2PQX', NOW);
    await expect(takeInvite(NOW + INVITE_TTL_MS)).resolves.toBe('K7M2PQX');
    await expect(takeInvite(NOW + INVITE_TTL_MS + MINUTE)).resolves.toBeNull();
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });

  it('мусор игнорируется; битая запись — null', async () => {
    await rememberInvite('K7M2PQ0', NOW);
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
    localStorage.setItem(INVITE_KEY, 'not json');
    await expect(takeInvite(NOW)).resolves.toBeNull();
  });

  it('хранилище недоступно — не бросает', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(rememberInvite('K7M2PQX', NOW)).resolves.toBeUndefined();
    await rememberInvite('K7M2PQX', NOW);
    await forgetInvite();
    await expect(takeInvite(NOW)).resolves.toBeNull();
  });
});
