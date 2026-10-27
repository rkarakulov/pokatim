import { useScrub, type ScrubStore } from '@/features/maps/scrub-store';

/**
 * Прокрутка экрана карточки при скраббинге (native, routes-04 RC-3): на время жеста по профилю или маркеру
 * (`dragging`) `ScrollView` не прокручивается — ре-рендер экрана дважды за жест. Web — `use-scrub-scroll-lock.web.ts`.
 */
export function useScrubScrollEnabled(scrub: ScrubStore): boolean {
  return useScrub(scrub, (state) => state.dragging === null);
}
