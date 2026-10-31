/**
 * Что хост вспышки не открывает снова в этом запуске приложения (память процесса; сброс — при выходе из аккаунта).
 * Ключ — `flashKey` (`code:level`, RC-L4): показанная бронза не скрывает серебро того же кода.
 *
 * - `shown` — ключи, показанные вспышкой: сбой `POST seen` откатывает `seen: false` в кэше, но вспышка не зацикливается
 *   (после перезапуска непомеченное сервером вспыхнет снова — at-least-once);
 * - `presented` — вся очередь вспышки (снимок): пока вспышка открыта — скрыта всегда; после ухода «назад» или через
 *   «Поделиться» посреди очереди — до ответа сервера новее последнего на момент ухода. Остаток вспыхнет после нового
 *   ответа (возврат на передний план после `staleTime`, pull-to-refresh).
 */
const shown = new Set<string>();
/** `dataUpdatedAt: null` — вспышка ещё открыта: её очередь скрыта при любом ответе сервера. */
let presented: { keys: ReadonlySet<string>; dataUpdatedAt: number | null } | null = null;

export const markShown = (key: string) => void shown.add(key);

/** Вспышка открыта с этой очередью (снимком): пока открыта — её ключи не открываются снова ни при каком ответе. */
export function openPresented(keys: readonly string[]) {
  presented = { keys: new Set(keys), dataUpdatedAt: null };
}

/**
 * Вспышка закрыта (любым путём: «Закрыть», «назад», «Поделиться»): очередь скрыта до ответа сервера новее
 * `dataUpdatedAt` — последнего ответа на момент ухода (в том числе пришедшего за время показа, ревью pass 2, LOW-1).
 */
export function closePresented(dataUpdatedAt: number) {
  if (presented) presented = { keys: presented.keys, dataUpdatedAt };
}

/** Ключи, исключаемые из очереди для данных с этим `dataUpdatedAt`. */
export function hiddenKeys(dataUpdatedAt: number): ReadonlySet<string> {
  if (
    presented === null ||
    (presented.dataUpdatedAt !== null && dataUpdatedAt > presented.dataUpdatedAt)
  ) {
    return shown;
  }
  return new Set([...shown, ...presented.keys]);
}

export function resetShown() {
  shown.clear();
  presented = null;
}
