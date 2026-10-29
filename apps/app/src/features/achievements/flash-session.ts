/**
 * Коды, показанные вспышкой в этом запуске приложения (память процесса). Сбой `POST seen` откатывает `seen: false` в
 * кэше — без этого набора хост открыл бы вспышку снова сразу после закрытия. После перезапуска невидимое сервером
 * вспыхнет ещё раз (at-least-once). Сбрасывается при выходе из аккаунта (хост без `ready`).
 */
const shown = new Set<string>();

export const shownCodes = (): ReadonlySet<string> => shown;
export const markShown = (code: string) => void shown.add(code);
export const resetShown = () => shown.clear();
