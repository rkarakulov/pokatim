// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { size, space, themes } from '@pokatim/design-tokens';

import { attributionCss, attributionPanelCss, collapseAttribution } from './attribution.ts';

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
    const dark = attributionCss('m1', themes.dark, true);
    expect(dark).toContain('[data-route-map="m1"] .maplibregl-ctrl.maplibregl-ctrl-attrib');
    expect(dark).toContain(`background-color:${themes.dark.surface.raised}`);
    expect(dark).toContain(`color:${themes.dark.text.secondary}`);
    expect(dark).toContain('filter:invert(1)');
    const light = attributionCss('m1', themes.light, false);
    expect(light).toContain(`background-color:${themes.light.surface.raised}`);
    expect(light).toContain('filter:none');
  });

  it('routes-04b (RC-9): подсказка кооперативных жестов — без затухания при reduce motion, в области карты', () => {
    expect(attributionCss('m1', themes.light, false)).toContain(
      '@media (prefers-reduced-motion: reduce){[data-route-map="m1"] .maplibregl-cooperative-gesture-screen{transition:none}}',
    );
  });

  it('переключатель своей кнопки «i» раскрывает контрол, как нажатие пользователя, и сворачивание больше не мешает', () => {
    const { container, attrib, handlers, map } = control();
    const toggle = collapseAttribution(map, container);
    let clicks = 0;
    container
      .querySelector('.maplibregl-ctrl-attrib-button')!
      .addEventListener('click', () => clicks++);
    toggle();
    expect(clicks).toBe(1);
    attrib.classList.add('maplibregl-compact-show');
    handlers.sourcedata!();
    expect(attrib.classList.contains('maplibregl-compact-show')).toBe(true);
  });

  it('приложение: кнопка MapLibre и свёрнутый контрол скрыты, раскрытый — справа от своей кнопки, цвета темы', () => {
    const css = attributionPanelCss('m1', themes.dark);
    expect(css).toContain(
      '[data-route-map="m1"] .maplibregl-ctrl.maplibregl-ctrl-attrib .maplibregl-ctrl-attrib-button{display:none}',
    );
    expect(css).toContain(
      '[data-route-map="m1"] .maplibregl-ctrl.maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show){display:none}',
    );
    // слева — отступ угла, своя кнопка и зазор
    expect(css).toContain(`margin:0 0 ${space.s2}px ${space.s2 + size.touchMin + space.s1}px`);
    expect(css).toContain(`background-color:${themes.dark.surface.raised}`);
    expect(css).toContain(`solid ${themes.dark.border.subtle}`);
  });
});
