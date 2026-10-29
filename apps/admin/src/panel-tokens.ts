/**
 * Размеры раскладки панели из прототипов «Протокол» (решение Q17, task admin-01 §8.2): в `@rkarakulov/design-tokens`
 * их нет. TODO(app-foundation, follow-up «вынести в базу»): токены `density.compact` (окно входа, диалог, колонка
 * формы, правая колонка) — задачей в app-foundation; после релиза модуль удаляется, CSS панели берёт переменные базы.
 * Только размеры раскладки, без цветов.
 */
export const PANEL_LAYOUT_TOKENS = {
  /** Окно входа (3a). */
  'auth-card-width': 400,
  /** Модальное окно с причиной. */
  'dialog-width': 420,
  /** Форма в одну колонку. */
  'form-width': 560,
  /** Правая колонка страницы. */
  'rail-width': 330,
  /** Фото райдера в карточке модерации профиля (profile-moderation, RC-P4). */
  'avatar-preview': 128,
} as const;

/** CSS-переменные `--panel-*` для `:root` (ставит `installDesignSystem` рядом с переменными темы). */
export function panelLayoutCss(): string {
  const lines = Object.entries(PANEL_LAYOUT_TOKENS).map(
    ([name, value]) => `  --panel-${name}: ${value}px;`,
  );
  return `:root {\n${lines.join('\n')}\n}\n`;
}
