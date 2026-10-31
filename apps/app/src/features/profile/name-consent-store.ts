import { create } from 'zustand';

/**
 * Предложение шита «Как вас показывать в результатах?» (name-consent-prompt, N1/N3) — в памяти, одно на запуск: мутация
 * `useEnterRace` предлагает его без зависимостей UI, карточка гонки забирает и показывает. Тесты сбрасывают стор как
 * новый запуск (`jest.setup.ts`).
 *
 * `raceId` — гонка новой заявки, ждёт решения; `shown` — условия N2 выполнены, шит открыт; `spent` — в этом запуске шит
 * уже предлагался (решён или ушёл без показа) — до перезапуска больше нет.
 */
interface NameConsentStore {
  raceId: string | null;
  shown: boolean;
  spent: boolean;
}

const initial: NameConsentStore = { raceId: null, shown: false, spent: false };
export const useNameConsentStore = create<NameConsentStore>(() => initial);

/** Новая заявка на гонку: предложить шит (если в этом запуске его ещё не предлагали). */
export function offerNameConsent(raceId: string): void {
  if (useNameConsentStore.getState().spent) return;
  useNameConsentStore.setState({ raceId, shown: false, spent: true });
}

/** Условия N2 выполнены — шит открыт (решение принимается один раз: сохранение меняет профиль, шит не мигает). */
export function showNameConsent(): void {
  if (useNameConsentStore.getState().raceId !== null) useNameConsentStore.setState({ shown: true });
}

/** Шит решён, закрыт или не нужен (N2) — предложение снято. */
export function closeNameConsent(): void {
  useNameConsentStore.setState({ raceId: null, shown: false });
}

/** Новый запуск (тесты). */
export function resetNameConsent(): void {
  useNameConsentStore.setState(initial);
}
