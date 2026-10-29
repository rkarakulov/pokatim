/**
 * Что хост вспышки не открывает снова в этом запуске приложения (память процесса; сброс — при выходе из аккаунта):
 *
 * - `shown` — коды, показанные вспышкой: сбой `POST seen` откатывает `seen: false` в кэше, но вспышка не зацикливается
 *   (после перезапуска непомеченное сервером вспыхнет снова — at-least-once);
 * - `presented` — вся очередь вспышки (снимок): пока вспышка открыта — скрыта всегда; после ухода «назад» или через
 *   «Поделиться» посреди очереди — до ответа сервера новее последнего на момент ухода. Остаток вспыхнет после нового
 *   ответа (возврат на передний план после `staleTime`, pull-to-refresh).
 */
const shown = new Set<string>();
/** `dataUpdatedAt: null` — вспышка ещё открыта: её очередь скрыта при любом ответе сервера. */
let presented: { codes: ReadonlySet<string>; dataUpdatedAt: number | null } | null = null;

export const markShown = (code: string) => void shown.add(code);

/** Вспышка открыта с этой очередью (снимком): пока открыта — её коды не открываются снова ни при каком ответе. */
export function openPresented(codes: readonly string[]) {
  presented = { codes: new Set(codes), dataUpdatedAt: null };
}

/**
 * Вспышка закрыта (любым путём: «Закрыть», «назад», «Поделиться»): очередь скрыта до ответа сервера новее
 * `dataUpdatedAt` — последнего ответа на момент ухода (в том числе пришедшего за время показа, ревью pass 2, LOW-1).
 */
export function closePresented(dataUpdatedAt: number) {
  if (presented) presented = { codes: presented.codes, dataUpdatedAt };
}

/** Коды, исключаемые из очереди для данных с этим `dataUpdatedAt`. */
export function hiddenCodes(dataUpdatedAt: number): ReadonlySet<string> {
  if (
    presented === null ||
    (presented.dataUpdatedAt !== null && dataUpdatedAt > presented.dataUpdatedAt)
  ) {
    return shown;
  }
  return new Set([...shown, ...presented.codes]);
}

export function resetShown() {
  shown.clear();
  presented = null;
}
