import { z } from 'zod';

/** Ключ состояния плашки «Установить приложение» в `localStorage` (только web). */
export const INSTALL_PROMPT_KEY = 'pokatim.pwaDialog';

export const MS_IN_DAY = 24 * 60 * 60 * 1000;
/** Визитов до первого показа и до повторного после «×». */
export const VISITS_BEFORE_PROMPT = 5;
/** Через сколько после «×» плашка возвращается, даже если визитов меньше. */
export const REMIND_AFTER_CLOSE_MS = 7 * MS_IN_DAY;

export interface InstallPromptState {
  /** показывать плашку; при старте всегда `false` — решает визит */
  showDialog: boolean;
  visitsCountAfterClosing: number;
  /** когда нажали «×», мс */
  closedTimestamp?: number;
}

const StoredInstallPrompt = z.object({
  visitsCountAfterClosing: z.number().int().nonnegative(),
  closedTimestamp: z.number().optional(),
});

/** Состояние при старте из сырого значения хранилища: нет или испорчено — как новый пользователь. */
export function readInstallPromptState(raw: string | null): InstallPromptState {
  const fresh: InstallPromptState = { showDialog: false, visitsCountAfterClosing: 0 };
  if (!raw) return fresh;
  try {
    const parsed = StoredInstallPrompt.safeParse(JSON.parse(raw));
    return parsed.success ? { ...parsed.data, showDialog: false } : fresh;
  } catch {
    return fresh;
  }
}

/** Визит: +1 к счётчику; плашка — с 5-го визита или через 7 дней после «×». */
export function registerVisit(state: InstallPromptState, now: number): InstallPromptState {
  const visitsCountAfterClosing = state.visitsCountAfterClosing + 1;
  const remind =
    state.closedTimestamp !== undefined && now - state.closedTimestamp >= REMIND_AFTER_CLOSE_MS;
  return {
    ...state,
    visitsCountAfterClosing,
    showDialog: visitsCountAfterClosing >= VISITS_BEFORE_PROMPT || remind,
  };
}

/** «×» на плашке: скрыть, счётчик с нуля, запомнить время. */
export function dismissInstallPrompt(now: number): InstallPromptState {
  return { showDialog: false, visitsCountAfterClosing: 0, closedTimestamp: now };
}
