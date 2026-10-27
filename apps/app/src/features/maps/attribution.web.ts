import type { AppTheme } from '@pokatim/design-tokens';

/*
 * Атрибуция web-карты (`maplibre-gl` 6) — баги ручной проверки maps-01 (B2, B4 maps-02). Атрибуция остаётся
 * доступной (ADR-0014 п. 3): кнопка «i» раскрывает её.
 */

const ATTRIBUTION = '.maplibregl-ctrl-attrib';
const SHOW = 'maplibregl-compact-show';

/**
 * B2: компактная атрибуция MapLibre при создании и при каждом обновлении источников раскрыта (`maplibregl-compact-
 * show`), на ширине 375 две строки закрывают ~¼ карты и старт. Сворачиваем до первого нажатия «i» пользователем —
 * дальше его выбор (контрол переключает класс сам).
 */
export function collapseAttribution(
  map: { on(event: string, handler: () => void): unknown },
  container: HTMLElement,
): void {
  let touched = false;
  container.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element | null)?.closest?.('.maplibregl-ctrl-attrib-button'))
        touched = true;
    },
    true,
  );
  const collapse = () => {
    if (!touched) container.querySelector(`${ATTRIBUTION}.${SHOW}`)?.classList.remove(SHOW);
  };
  collapse();
  map.on('styledata', collapse);
  map.on('sourcedata', collapse);
}

/**
 * B4: контрол атрибуции по теме приложения (по умолчанию — светлая плашка и чёрная «i» в любой теме). Правила —
 * в области `[data-route-map="scope"]` карты, цвета — роли темы; иконка «i» — SVG фона MapLibre (чёрная), в тёмной
 * теме инвертируется. Подсказка кооперативных жестов (routes-04b) — цвета MapLibre (затемнение, нейтрально в обеих
 * темах, RC-10), при reduce motion — без анимации.
 */
export function attributionCss(scope: string, theme: AppTheme): string {
  const root = `[data-route-map="${scope}"]`;
  const dark = theme.map.basemap === 'dark';
  return [
    `${root} .maplibregl-ctrl.maplibregl-ctrl-attrib{background-color:${theme.surface.raised};color:${theme.text.secondary}}`,
    `${root} .maplibregl-ctrl-attrib a{color:${theme.text.secondary}}`,
    `${root} .maplibregl-ctrl-attrib-button{filter:${dark ? 'invert(1)' : 'none'}}`,
    // routes-04b (RC-9): подсказка кооперативных жестов без затухания при reduce motion
    `@media (prefers-reduced-motion: reduce){${root} .maplibregl-cooperative-gesture-screen{transition:none}}`,
  ].join('\n');
}
