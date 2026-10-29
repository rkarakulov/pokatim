/**
 * Что хост вспышки не открывает снова в этом запуске приложения (память процесса; сброс — при выходе из аккаунта):
 *
 * - `shown` — коды, показанные вспышкой: сбой `POST seen` откатывает `seen: false` в кэше, но вспышка не зацикливается
 *   (после перезапуска непомеченное сервером вспыхнет снова — at-least-once);
 * - `presented` — вся очередь открытой вспышки (снимок) и время ответа сервера, из которого она собрана: уход со вспышки
 *   «назад» или через «Поделиться» посреди очереди не открывает её сразу снова с остатком. Остаток вспыхнет после
 *   нового ответа сервера (возврат на передний план после `staleTime`, pull-to-refresh) — `dataUpdatedAt` больше.
 */
const shown = new Set<string>();
let presented: { codes: ReadonlySet<string>; dataUpdatedAt: number } | null = null;

export const markShown = (code: string) => void shown.add(code);

/** Очередь вспышки открыта: её коды не открываются снова до ответа сервера новее `dataUpdatedAt`. */
export function markPresented(codes: readonly string[], dataUpdatedAt: number) {
  presented = { codes: new Set(codes), dataUpdatedAt };
}

/** Коды, исключаемые из очереди для данных с этим `dataUpdatedAt`. */
export function hiddenCodes(dataUpdatedAt: number): ReadonlySet<string> {
  if (presented === null || dataUpdatedAt > presented.dataUpdatedAt) return shown;
  return new Set([...shown, ...presented.codes]);
}

export function resetShown() {
  shown.clear();
  presented = null;
}
