import type { TicketView } from '@pokatim/contracts';
import { File, Paths } from 'expo-file-system';
import { z } from 'zod';

import { secureStorage } from '@/features/auth/secure-storage';

import {
  type OfflineSnapshot,
  type OfflineTicket,
  parseSnapshot,
  pickTicket,
  prunedSnapshot,
  withTicket,
} from './offline-model';

/**
 * Native (plan-B §5): QR-токены — только в SecureStore (`pokatim.ticketQr`: владелец и `{ код: PKT1… }`, ≤ 10 × ~60 Б
 * — в пределах 2 КБ ключа); остальное (`view` с `qr: null`, `savedAt`) — файл `tickets-offline.json` в кеше
 * приложения: не уходит в iCloud/Google-бэкап (ПДн участника); ОС может очистить кеш при нехватке места — тогда копии нет,
 * QR без файла стирается при чтении. Копия — склейка; владелец файла и ключа не совпал — стираются оба. Сбой хранилища — тихо (без копии),
 * в журнал — только имя ошибки (не данные билета).
 */
const QR_KEY = 'pokatim.ticketQr';
const FILE_NAME = 'tickets-offline.json';

const QrStoreSchema = z.object({ owner: z.string().min(1), qr: z.record(z.string(), z.string()) });
type QrStore = z.infer<typeof QrStoreSchema>;

const ticketsFile = () => new File(Paths.cache, FILE_NAME);

const warn = (error: unknown) =>
  console.warn(`Офлайн-копия билета: ${error instanceof Error ? error.name : 'Error'}`);

async function readFile(): Promise<OfflineSnapshot | null> {
  const file = ticketsFile();
  if (!file.exists) return null;
  return parseSnapshot(await file.text());
}

async function readQr(): Promise<QrStore | null> {
  const raw = await secureStorage.get(QR_KEY);
  if (raw === null) return null;
  try {
    const parsed = QrStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Склейка файла и QR; несогласованные части (разные владельцы, повреждение) — `null` и стирание. */
async function readSnapshot(): Promise<OfflineSnapshot | null> {
  const [snapshot, qr] = await Promise.all([readFile(), readQr()]);
  if (!snapshot) {
    if (qr) await secureStorage.delete(QR_KEY);
    return null;
  }
  if (qr && qr.owner !== snapshot.owner) {
    await wipe();
    return null;
  }
  const items = Object.fromEntries(
    Object.entries(snapshot.items).map(([code, entry]) => [
      code,
      { ...entry, view: { ...entry.view, qr: qr?.qr[code] ?? null } },
    ]),
  );
  return { owner: snapshot.owner, items };
}

async function writeSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  const qr: Record<string, string> = {};
  const items: Record<string, OfflineTicket> = {};
  for (const [code, entry] of Object.entries(snapshot.items)) {
    if (entry.view.qr) qr[code] = entry.view.qr;
    items[code] = { ...entry, view: { ...entry.view, qr: null } };
  }
  // сначала ключ: файл без QR безопасен, QR без файла стирается при чтении
  await secureStorage.set(QR_KEY, JSON.stringify({ owner: snapshot.owner, qr }));
  await ticketsFile().write(JSON.stringify({ owner: snapshot.owner, items }));
}

async function wipe(): Promise<void> {
  await secureStorage.delete(QR_KEY);
  const file = ticketsFile();
  if (file.exists) file.delete();
}

/** Операции по очереди: запись после чтения не теряет параллельную запись другого билета. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>, fallback: T): Promise<T> {
  const next = queue.then(task).catch((error: unknown) => {
    warn(error);
    return fallback;
  });
  queue = next;
  return next;
}

/** Копия билета владельца `owner` после успешного `getTicket`. */
export function saveOfflineTicket(owner: string, view: TicketView, now = Date.now()) {
  return serial(async () => {
    await writeSnapshot(withTicket(await readSnapshot(), owner, view, now));
  }, undefined);
}

/** Копия для показа; `owner: null` — владелец неизвестен (только web, RC-B4). */
export function readOfflineTicket(
  owner: string | null,
  code: string,
  now = Date.now(),
): Promise<OfflineTicket | null> {
  return serial(async () => {
    let snapshot = await readSnapshot();
    if (snapshot && owner !== null && snapshot.owner !== owner) {
      await wipe();
      return null;
    }
    // просроченные копии удаляются из файла и SecureStore, а не только скрываются
    const pruned = prunedSnapshot(snapshot, now);
    if (pruned) {
      if (Object.keys(pruned.items).length === 0) await wipe();
      else await writeSnapshot(pruned);
      snapshot = pruned;
    }
    return pickTicket(snapshot, owner, code, now);
  }, null);
}

/** Билет не найден (404) — копия этого кода стирается. */
export function removeOfflineTicket(code: string) {
  return serial(async () => {
    const snapshot = await readSnapshot();
    if (!snapshot?.items[code]) return;
    const items = Object.fromEntries(
      Object.entries(snapshot.items).filter(([key]) => key !== code),
    );
    await writeSnapshot({ owner: snapshot.owner, items });
  }, undefined);
}

/** Выход из аккаунта: все копии и QR стираются. */
export function clearOfflineTickets() {
  return serial(wipe, undefined);
}
