/// <reference types="jest" />
import { calendarTicket, raceTicket } from './fixtures';
import {
  clearOfflineTickets,
  OFFLINE_TICKETS_KEY,
  readOfflineTicket,
  removeOfflineTicket,
  saveOfflineTicket,
} from './offline-store.web';

const OWNER = 'user-a';
const NOW = Date.parse('2027-06-01T10:00:00Z');

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('офлайн-копии билетов — web (AC12, RC-B4)', () => {
  it('запись и чтение владельцем из localStorage', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    expect(localStorage.getItem(OFFLINE_TICKETS_KEY)).toContain(raceTicket.code);
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.toEqual({
      view: raceTicket,
      savedAt: NOW,
    });
  });

  it('другой владелец — копии нет, запись стирается; владелец неизвестен (null) — копия своего снимка', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    await expect(readOfflineTicket(null, raceTicket.code, NOW)).resolves.not.toBeNull();
    await expect(readOfflineTicket('user-b', raceTicket.code, NOW)).resolves.toBeNull();
    expect(localStorage.getItem(OFFLINE_TICKETS_KEY)).toBeNull();
  });

  it('удаление кода и выход: копии и кеш оболочки service worker', async () => {
    const deleted: string[] = [];
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        keys: async () => ['tickets-shell-abc', 'static-123'],
        delete: async (key: string) => {
          deleted.push(key);
          return true;
        },
      },
    });
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    await saveOfflineTicket(OWNER, calendarTicket, NOW);
    await removeOfflineTicket(raceTicket.code);
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.toBeNull();

    await clearOfflineTickets();
    expect(localStorage.getItem(OFFLINE_TICKETS_KEY)).toBeNull();
    expect(deleted).toEqual(['tickets-shell-abc']);
    Reflect.deleteProperty(globalThis, 'caches');
  });

  it('сбой хранилища — без броска и без копии', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await expect(saveOfflineTicket(OWNER, raceTicket, NOW)).resolves.toBeUndefined();
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.toBeNull();
  });
});
