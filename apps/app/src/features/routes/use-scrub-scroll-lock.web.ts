import type { ScrubStore } from '@/features/maps/scrub-store';

/**
 * Web (ревью pass 1, M2): прокрутку не выключаем — `scrollEnabled={false}` в RN-web даёт единственному скроллеру
 * страницы `overflow: hidden` и `touch-action: none` (свайп с профиля не прокручивает, полоса прокрутки исчезает и
 * карта прыгает). Браузер разводит жесты сам: график — `touch-action: pan-y`, маркер — `none` + захват указателя.
 */
export function useScrubScrollEnabled(_scrub: ScrubStore): boolean {
  return true;
}
