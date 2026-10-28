import { shapeOf, size, space, stroke, type Theme } from '@pokatim/design-tokens';

/*
 * Атрибуция web-карты (`maplibre-gl` 6; приложение и панель) — баги ручной проверки maps-01 (B2, B4 maps-02). Атрибуция остаётся
 * доступной (ADR-0014 п. 3): кнопка «i» раскрывает её.
 */

const ATTRIBUTION = '.maplibregl-ctrl-attrib';
const SHOW = 'maplibregl-compact-show';

/**
 * B2: компактная атрибуция MapLibre при создании и при каждом обновлении источников раскрыта (`maplibregl-compact-
 * show`), на ширине 375 две строки закрывают ~¼ карты и старт. Сворачиваем до первого нажатия «i» пользователем —
 * дальше его выбор (контрол переключает класс сам). Возвращает переключатель для своей кнопки «i» (приложение,
 * `attributionPanelCss`): нажатие на кнопку контрола — то же, что нажатие пользователя.
 */
export function collapseAttribution(
  map: { on(event: string, handler: () => void): unknown },
  container: HTMLElement,
): () => void {
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
  return () => container.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-button')?.click();
}

/**
 * B4: контрол атрибуции по теме (по умолчанию — светлая плашка и чёрная «i» в любой теме). Правила — в области
 * `[data-route-map="scope"]` карты, цвета — роли темы; иконка «i» — SVG фона MapLibre (чёрная), в тёмной теме
 * (`dark`) инвертируется. Подсказка кооперативных жестов (routes-04b) — цвета MapLibre (затемнение, нейтрально в обеих
 * темах, RC-10), при reduce motion — без анимации.
 */
export function attributionCss(
  scope: string,
  theme: Pick<Theme, 'surface' | 'text'>,
  dark: boolean,
): string {
  const root = `[data-route-map="${scope}"]`;
  return [
    `${root} .maplibregl-ctrl.maplibregl-ctrl-attrib{background-color:${theme.surface.raised};color:${theme.text.secondary}}`,
    `${root} .maplibregl-ctrl-attrib a{color:${theme.text.secondary}}`,
    `${root} .maplibregl-ctrl-attrib-button{filter:${dark ? 'invert(1)' : 'none'}}`,
    // routes-04b (RC-9): подсказка кооперативных жестов без затухания при reduce motion
    `@media (prefers-reduced-motion: reduce){${root} .maplibregl-cooperative-gesture-screen{transition:none}}`,
  ].join('\n');
}

/**
 * Атрибуция приложения: кнопка «i» — своя (`MapAttributionButton`: иконка дизайн-системы и подпись для a11y) вместо
 * кнопки MapLibre — та читалась точкой без смысла. Кнопка контрола скрыта, свёрнутый контрол — тоже;
 * раскрытый (`collapseAttribution` → переключатель) — плашка справа от своей кнопки, цвета и форма — темы.
 */
export function attributionPanelCss(scope: string, theme: Theme): string {
  const root = `[data-route-map="${scope}"]`;
  const attrib = `${root} .maplibregl-ctrl.maplibregl-ctrl-attrib`;
  const left = space.s2 + size.touchMin + space.s1;
  return [
    attributionCss(scope, theme, false),
    // специфичность выше правил maplibre-gl для компактного контрола (`.maplibregl-compact .…-button{display:block}`)
    `${attrib} .maplibregl-ctrl-attrib-button{display:none}`,
    `${attrib}.maplibregl-compact:not(.maplibregl-compact-show){display:none}`,
    `${attrib}.maplibregl-compact-show{margin:0 0 ${space.s2}px ${left}px;padding:${space.s1}px ${space.s2}px;` +
      `max-width:calc(100vw - ${left + space.s4}px);border:${stroke.hairline}px solid ${theme.border.subtle};` +
      `border-radius:${shapeOf(theme).card}px}`,
  ].join('\n');
}
