/** Сколько видна подсказка «колесо с Ctrl/⌘» после последнего прокручивания колесом над картой, мс. */
export const WHEEL_HINT_MS = 1500;

/**
 * Колесо мыши над web-картой (routes-04c): зум — только с Ctrl/⌘ (и щипок тачпада — браузер шлёт его колесом с
 * `ctrlKey`), без модификатора — прокрутка страницы. `cooperativeGestures` maplibre-gl 6 связывает колесо с тачем
 * (один палец тоже отдаётся странице), поэтому он выключен, а колесо без модификатора гасится здесь: слушатель в фазе
 * перехвата на контейнере карты останавливает событие до `scrollZoom` (он слушает внутренний узел холста) и не
 * отменяет его — страница прокручивается; `onBlocked` — показать подсказку. С модификатором событие идёт дальше —
 * зум `scrollZoom` вокруг курсора. Возвращает функцию снятия слушателя.
 */
export function guardWheelZoom(container: HTMLElement, onBlocked: () => void): () => void {
  const listener = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    onBlocked();
  };
  container.addEventListener('wheel', listener, { capture: true, passive: true });
  return () => container.removeEventListener('wheel', listener, { capture: true });
}

/** Подсказка — с ⌘ на Mac, с Ctrl на остальных (оба модификатора работают везде). */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
}
