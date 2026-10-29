/// <reference types="jest" />
import { calendarTicket, QR, raceTicket } from './fixtures';
import { OFFLINE_TICKETS_LIMIT } from './offline-model';
import {
  clearOfflineTickets,
  readOfflineTicket,
  removeOfflineTicket,
  saveOfflineTicket,
} from './offline-store';

// файлы кеша приложения — в памяти (общий мок jest.setup не умеет читать и писать)
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  class File {
    uri: string;
    constructor(...parts: ({ uri?: string } | string)[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : (part.uri ?? '')))
        .join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    async text() {
      return files.get(this.uri) ?? '';
    }
    async write(content: string) {
      files.set(this.uri, content);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return {
    __files: files,
    File,
    Paths: { cache: { uri: 'file:///caches' }, document: { uri: 'file:///documents' } },
  };
});

const files = () => jest.requireMock<{ __files: Map<string, string> }>('expo-file-system').__files;
const secure = () =>
  jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const fileText = () => [...files().values()].join('');

const OWNER = 'user-a';
/** 1 июня 2027 — до событий фикстур. */
const NOW = Date.parse('2027-06-01T10:00:00Z');

beforeEach(() => files().clear());

describe('офлайн-копии билетов — native (AC12)', () => {
  it('запись и чтение: QR — только в SecureStore, файл — без QR, в кеше приложения (без iCloud-бэкапа)', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    expect([...files().keys()]).toEqual(['file:///caches/tickets-offline.json']);

    expect(fileText()).toContain(raceTicket.event.title);
    expect(fileText()).not.toContain(QR);
    expect(secure().get('pokatim.ticketQr')).toContain(QR);
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW + 1)).resolves.toEqual({
      view: raceTicket,
      savedAt: NOW,
    });
  });

  it('другой владелец — копии нет, обе части стираются', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);

    await expect(readOfflineTicket('user-b', raceTicket.code, NOW)).resolves.toBeNull();
    expect(files().size).toBe(0);
    expect(secure().has('pokatim.ticketQr')).toBe(false);
  });

  it('запись другим владельцем начинает новый снимок (чужие билеты не остаются)', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    await saveOfflineTicket('user-b', calendarTicket, NOW);

    await expect(readOfflineTicket('user-b', raceTicket.code, NOW)).resolves.toBeNull();
    expect(fileText()).not.toContain(raceTicket.event.title);
    expect(secure().get('pokatim.ticketQr')).not.toContain(OWNER);
  });

  it('TTL: сутки после конца события — копии нет; событие прошло — без QR', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    const ended = Date.parse(raceTicket.event.endsAt!);

    const after = await readOfflineTicket(OWNER, raceTicket.code, ended + 60_000);
    expect(after?.view.qr).toBeNull();
    expect(after?.view.past).toBe(true);
    await expect(
      readOfflineTicket(OWNER, raceTicket.code, ended + 25 * 3_600_000),
    ).resolves.toBeNull();
    // просроченная копия удаляется из хранилищ, а не только скрывается
    expect(fileText()).not.toContain(raceTicket.event.title);
    expect(secure().get('pokatim.ticketQr') ?? '').not.toContain(QR);
  });

  it('чтение другого билета тоже удаляет просроченные копии', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    await saveOfflineTicket(
      OWNER,
      {
        ...calendarTicket,
        event: { ...calendarTicket.event, startsAt: '2027-07-20T05:00:00.000Z' },
      },
      NOW,
    );
    const later = Date.parse('2027-06-16T12:00:00Z');

    await expect(readOfflineTicket(OWNER, calendarTicket.code, later)).resolves.not.toBeNull();
    expect(fileText()).not.toContain(raceTicket.event.title);
    expect(fileText()).toContain(calendarTicket.event.title);
  });

  it(`не больше ${OFFLINE_TICKETS_LIMIT} копий — остаются свежие`, async () => {
    for (let i = 0; i < OFFLINE_TICKETS_LIMIT + 2; i += 1) {
      await saveOfflineTicket(
        OWNER,
        { ...raceTicket, code: `ABCDE${String(i).padStart(5, '0')}` },
        NOW + i,
      );
    }
    await expect(readOfflineTicket(OWNER, 'ABCDE00000', NOW + 20)).resolves.toBeNull();
    await expect(readOfflineTicket(OWNER, 'ABCDE00011', NOW + 20)).resolves.not.toBeNull();
    const qr = JSON.parse(secure().get('pokatim.ticketQr')!) as { qr: Record<string, string> };
    expect(Object.keys(qr.qr)).toHaveLength(OFFLINE_TICKETS_LIMIT);
  });

  it('удаление кода (404) и стирание при выходе', async () => {
    await saveOfflineTicket(OWNER, raceTicket, NOW);
    await saveOfflineTicket(OWNER, calendarTicket, NOW);

    await removeOfflineTicket(raceTicket.code);
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.toBeNull();
    await expect(readOfflineTicket(OWNER, calendarTicket.code, NOW)).resolves.not.toBeNull();

    await clearOfflineTickets();
    expect(files().size).toBe(0);
    expect(secure().has('pokatim.ticketQr')).toBe(false);
  });

  it('повреждённый файл — копии нет, без броска', async () => {
    files().set('file:///caches/tickets-offline.json', '{oops');
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.toBeNull();
  });

  it('параллельные записи двух билетов не теряют друг друга', async () => {
    await Promise.all([
      saveOfflineTicket(OWNER, raceTicket, NOW),
      saveOfflineTicket(OWNER, calendarTicket, NOW),
    ]);
    await expect(readOfflineTicket(OWNER, raceTicket.code, NOW)).resolves.not.toBeNull();
    await expect(readOfflineTicket(OWNER, calendarTicket.code, NOW)).resolves.not.toBeNull();
  });
});
