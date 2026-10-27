/// <reference types="jest" />
import type { CatalogRouteElevation } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { createScrubStore, SCRUB_MARKER_ATTR, type ScrubStore } from '@/features/maps/scrub-store';

import { ProfileArea, ProfileChart } from './profile-chart.web';
import { PROFILE_FILL_OPACITY } from './profile-style';

const elevation: CatalogRouteElevation = {
  minM: 191,
  maxM: 267,
  profile: Array.from({ length: 300 }, (_, i) => [i * 227, 191 + (i % 77)]),
};

describe('ProfileArea web (fix профиля routes-03)', () => {
  it('плавный SVG-путь по всем точкам: линия map.corridor и заливка-градиент (G1), без столбиков; SSR детерминирован', () => {
    const html = renderToString(<ProfileArea elevation={elevation} theme={themes.light} />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('preserveAspectRatio="none"');
    // G1: заливка — вертикальный градиент цвета линии: у линии PROFILE_FILL_OPACITY, внизу прозрачно
    const gradient = /<linearGradient id="([^"]+)" x1="0" y1="0" x2="0" y2="1">/.exec(html)?.[1];
    expect(gradient).toBe('elevation-profile-fill');
    expect(html).toContain(`fill="url(#${gradient})"`);
    expect(html).toContain(
      `<stop offset="0" stop-color="${themes.light.map.corridor}" stop-opacity="${PROFILE_FILL_OPACITY}"></stop>`,
    );
    expect(html).toContain(
      `<stop offset="1" stop-color="${themes.light.map.corridor}" stop-opacity="0"></stop>`,
    );
    expect(html).toContain(`stroke="${themes.light.map.corridor}"`);
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).not.toContain('elevation-profile-bar');
    // линия — по каждой точке профиля: M + 299 × L
    const line = /<path d="(M[^"]+)" fill="none"/.exec(html)?.[1] ?? '';
    expect(line.split('L')).toHaveLength(300);
    expect(renderToString(<ProfileArea elevation={elevation} theme={themes.light} />)).toBe(html);
  });

  it('тёмная тема — свой приглушённый цвет; меньше двух точек — пусто', () => {
    const html = renderToString(<ProfileArea elevation={elevation} theme={themes.dark} />);
    expect(html).toContain(`stroke="${themes.dark.map.corridor}"`);
    expect(
      renderToString(
        <ProfileArea elevation={{ minM: 1, maxM: 1, profile: [[0, 1]] }} theme={themes.dark} />,
      ),
    ).toBe('');
  });
});

// --- routes-04: slider, курсор, pointer и клавиши ---

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
async function mount(element: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => created.render(element));
  return host;
}
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

// 0 → 2 км: подъём 5 % до 1 км, дальше спуск 3 %
const scrubElevation: CatalogRouteElevation = {
  minM: 200,
  maxM: 250,
  profile: Array.from({ length: 9 }, (_, i) => {
    const d = i * 250;
    return [d, d <= 1000 ? 200 + d * 0.05 : 250 - (d - 1000) * 0.03];
  }),
};
const LABEL = 'Профиль высоты: от 200 до 250 м, набор 50 м';
const chart = (store?: ScrubStore) => (
  <ProfileChart
    elevation={scrubElevation}
    distanceM={2000}
    gainM={50}
    theme={themes.light}
    label={LABEL}
    scrub={store}
  />
);

/** jsdom без раскладки и PointerEvent: ширина графика 200 px, событие — MouseEvent с pointerType. */
function layout(element: Element) {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 50, right: 200, bottom: 50 }) as DOMRect;
}
function pointer(
  target: Element,
  type: string,
  clientX: number,
  pointerType = 'mouse',
  extra = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...extra });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}
const slider = (host: HTMLElement) => host.querySelector('[role="slider"]')!;
const cursor = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-testid="elevation-profile-cursor"]')!;

describe('ProfileChart web: скраббинг (routes-04, RC-13)', () => {
  it('без scrub — изображение с текстовой альтернативой, как в routes-03', () => {
    const html = renderToString(chart());
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).not.toContain('role="slider"');
  });

  it('SSR: slider c aria-* для 0 км, курсор скрыт, SVG-площадь; серверная разметка = первый клиентский рендер', async () => {
    const html = renderToString(chart(createScrubStore()));
    expect(html).toContain('role="slider"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="2000"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuetext="0 км, высота 200 м, уклон 5 %"');
    expect(html).toContain('touch-action:pan-y');
    // без `<style>` и `useId` в разметке: текст и id не зависят от положения в дереве (React #418 смоука web)
    expect(html).not.toContain('<style');
    expect(html).toContain('url(#elevation-profile-fill)');
    expect(html).toContain('<svg');
    expect(html).toContain('display:none');
    expect(renderToString(chart(createScrubStore()))).toBe(html);
    const nested = renderToString(
      <section>
        <div>{chart(createScrubStore())}</div>
      </section>,
    );
    expect(nested).toBe(`<section><div>${html}</div></section>`);
  });

  it('клавиши: → и ↑ +1 км, ← и ↓ −1 км, Home/End — концы; курсор появляется', async () => {
    const store = createScrubStore();
    const host = await mount(chart(store));
    const node = slider(host);
    const key = (name: string) =>
      act(async () => {
        node.dispatchEvent(
          new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
        );
      });
    await key('ArrowRight');
    expect(store.getState()).toMatchObject({ fraction: 0.5, active: true });
    expect(node.getAttribute('aria-valuenow')).toBe('1000');
    expect(node.getAttribute('aria-valuetext')).toBe('1 км, высота 250 м, уклон 1 %');
    expect(cursor(host).style.display).toBe('block');
    expect(cursor(host).style.left).toBe('50%');
    await key('ArrowUp');
    expect(store.getState().fraction).toBe(1);
    expect(node.getAttribute('aria-valuetext')).toBe('2 км, высота 220 м, уклон −3 %');
    await key('ArrowLeft');
    await key('ArrowDown');
    expect(store.getState().fraction).toBe(0);
    await key('End');
    expect(store.getState().fraction).toBe(1);
    await key('Home');
    expect(store.getState().fraction).toBe(0);
    // прочие клавиши не перехватываются (Tab уводит фокус)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    node.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('мышь: hover ведёт курсор по доле X, уход мыши — курсор скрыт', async () => {
    const store = createScrubStore();
    const host = await mount(chart(store));
    const node = slider(host);
    layout(node);
    await act(async () => pointer(node, 'pointermove', 50));
    expect(store.getState()).toMatchObject({ fraction: 0.25, active: true, dragging: null });
    expect(cursor(host).style.display).toBe('block');
    // React: onPointerLeave — из pointerout с relatedTarget вне графика
    await act(async () =>
      pointer(node, 'pointerout', 250, 'mouse', { relatedTarget: document.body }),
    );
    expect(store.getState().active).toBe(false);
    expect(cursor(host).style.display).toBe('none');
  });

  it('касание: pointerdown ведёт (dragging), без нажатия move не ведёт; pointerdown вне графика и маркера — скрыто', async () => {
    const store = createScrubStore();
    const host = await mount(chart(store));
    const node = slider(host);
    layout(node);
    await act(async () => pointer(node, 'pointermove', 100, 'touch'));
    expect(store.getState().active).toBe(false);
    await act(async () => pointer(node, 'pointerdown', 20, 'touch'));
    expect(store.getState()).toMatchObject({ fraction: 0.1, active: true, dragging: 'profile' });
    await act(async () => pointer(node, 'pointermove', 150, 'touch'));
    expect(store.getState().fraction).toBe(0.75);
    await act(async () => pointer(node, 'pointerup', 150, 'touch'));
    expect(store.getState()).toMatchObject({ active: true, dragging: null });
    // касание маркера карты курсор не скрывает
    const marker = document.createElement('div');
    marker.setAttribute(SCRUB_MARKER_ATTR, '');
    document.body.append(marker);
    await act(async () => pointer(marker, 'pointerdown', 0, 'touch'));
    expect(store.getState().active).toBe(true);
    await act(async () => pointer(document.body, 'pointerdown', 0, 'touch'));
    expect(store.getState().active).toBe(false);
  });

  it('касание отменено браузером (началась прокрутка, pan-y) — курсор скрыт, как на native', async () => {
    const store = createScrubStore();
    const host = await mount(chart(store));
    const node = slider(host);
    layout(node);
    await act(async () => pointer(node, 'pointerdown', 20, 'touch'));
    expect(store.getState()).toMatchObject({ active: true, dragging: 'profile' });
    await act(async () => pointer(node, 'pointercancel', 20, 'touch'));
    expect(store.getState()).toMatchObject({ active: false, dragging: null });
  });
});
