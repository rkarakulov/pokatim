/// <reference types="jest" />
import { createScrubStore, type ScrubStore } from '@pokatim/route-view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScrollView, Text } from 'react-native';

import { useScrubScrollEnabled } from './use-scrub-scroll-lock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** Экран как `RouteDetailScreen`: единственный скроллер страницы, `scrollEnabled` — из хука. */
function Screen({ store }: { store: ScrubStore }) {
  return (
    <ScrollView testID="route-detail" scrollEnabled={useScrubScrollEnabled(store)}>
      <Text>карточка</Text>
    </ScrollView>
  );
}

describe('useScrubScrollEnabled web (ревью pass 1, M2)', () => {
  it('жест по профилю или маркеру не даёт скроллеру overflow: hidden / touch-action: none', async () => {
    const store = createScrubStore();
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<Screen store={store} />));
    const scroller = () => host.querySelector<HTMLElement>('[data-testid="route-detail"]')!;
    const style = () => getComputedStyle(scroller());
    const initial = { overflowY: style().overflowY, touchAction: style().touchAction };
    expect(initial.overflowY).not.toBe('hidden');
    for (const dragging of ['profile', 'map'] as const) {
      await act(async () => store.setState({ dragging, active: true }));
      expect(style().overflowY).toBe(initial.overflowY);
      expect(style().touchAction).toBe(initial.touchAction);
    }
  });
});
