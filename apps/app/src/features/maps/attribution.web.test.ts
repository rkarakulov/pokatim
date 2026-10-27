/// <reference types="jest" />
import { themes } from '@pokatim/design-tokens';

import { attributionCss, collapseAttribution } from './attribution.web';

/** Разметка контрола атрибуции maplibre-gl 6 (компактный, раскрытый — как после создания). */
function control() {
  const container = document.createElement('div');
  container.innerHTML =
    '<details class="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show" open>' +
    '<summary class="maplibregl-ctrl-attrib-button"></summary><div class="maplibregl-ctrl-attrib-inner">© OSM</div></details>';
  const attrib = container.querySelector('.maplibregl-ctrl-attrib')!;
  const handlers: Record<string, () => void> = {};
  const map = { on: (event: string, handler: () => void) => (handlers[event] = handler) };
  return { container, attrib, handlers, map };
}

describe('атрибуция web-карты (B2, B4 maps-02)', () => {
  it('B2: свёрнута сразу и после обновления стиля/источников; кнопка «i» остаётся', () => {
    const { container, attrib, handlers, map } = control();
    collapseAttribution(map, container);
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(attrib.classList.contains('maplibregl-compact')).toBe(true);
    expect(container.querySelector('.maplibregl-ctrl-attrib-button')).not.toBeNull();
    attrib.classList.add('maplibregl-compact-show');
    handlers.sourcedata!();
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);
    attrib.classList.add('maplibregl-compact-show');
    handlers.styledata!();
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);
  });

  it('B2: пользователь раскрыл «i» — больше не сворачиваем', () => {
    const { container, attrib, handlers, map } = control();
    collapseAttribution(map, container);
    const button = container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button')!;
    button.click();
    attrib.classList.add('maplibregl-compact-show');
    handlers.sourcedata!();
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(true);
  });

  it('B4: цвета контрола — роли темы в области карты; «i» инвертируется только в тёмной', () => {
    const dark = attributionCss('m1', themes.dark);
    expect(dark).toContain('[data-route-map="m1"] .maplibregl-ctrl.maplibregl-ctrl-attrib');
    expect(dark).toContain(`background-color:${themes.dark.surface.raised}`);
    expect(dark).toContain(`color:${themes.dark.text.secondary}`);
    expect(dark).toContain('filter:invert(1)');
    const light = attributionCss('m1', themes.light);
    expect(light).toContain(`background-color:${themes.light.surface.raised}`);
    expect(light).toContain('filter:none');
  });

  it('routes-04b (RC-9): подсказка кооперативных жестов — без затухания при reduce motion, в области карты', () => {
    expect(attributionCss('m1', themes.light)).toContain(
      '@media (prefers-reduced-motion: reduce){[data-route-map="m1"] .maplibregl-cooperative-gesture-screen{transition:none}}',
    );
  });
});
