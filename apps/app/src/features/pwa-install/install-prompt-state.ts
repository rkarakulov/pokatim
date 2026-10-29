import { z } from 'zod';

/** Ключ состояния плашки «Установить приложение» в `localStorage` (только web). */
export const INSTALL_PROMPT_KEY = 'pokatim.pwaDialog';

export const MS_IN_DAY = 24 * 60 * 60 * 1000;
/** Сколько плашка не показывается после «×» (решение 2026-10-29: с первого визита, без счётчика визитов). */
export const REMIND_AFTER_CLOSE_MS = 7 * MS_IN_DAY;

export interface InstallPromptState {
  /** показывать плашку; при старте `false` — решает визит */
  showDialog: boolean;
  /** когда нажали «×», мс */
  closedTimestamp?: number;
}

// старое значение со счётчиком `visitsCountAfterClosing` (до 2026-10-29) читается: лишнее поле отбрасывается
const StoredInstallPrompt = z.object({ closedTimestamp: z.number().optional() });

/** Состояние при старте из сырого значения хранилища: нет или испорчено — как новый пользователь. */
export function readInstallPromptState(raw: string | null): InstallPromptState {
  const fresh: InstallPromptState = { showDialog: false };
  if (!raw) return fresh;
  try {
    const parsed = StoredInstallPrompt.safeParse(JSON.parse(raw));
    return parsed.success ? { ...parsed.data, showDialog: false } : fresh;
  } catch {
    return fresh;
  }
}

/** Визит: плашка — с первого визита; после «×» — только когда прошло 7 дней. */
export function registerVisit(state: InstallPromptState, now: number): InstallPromptState {
  return {
    ...state,
    showDialog:
      state.closedTimestamp === undefined || now - state.closedTimestamp >= REMIND_AFTER_CLOSE_MS,
  };
}

/** «×» на плашке: скрыть и запомнить время. */
export function dismissInstallPrompt(now: number): InstallPromptState {
  return { showDialog: false, closedTimestamp: now };
}
