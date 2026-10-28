import { baseMessages, createI18n, mergeDictionaries, type Params } from '@rkarakulov/i18n-core';

import { ru } from './ru.ts';

/** Строки базы (состояния загрузки, даты, поля, витрина) + строки проекта; ключи проекта переопределяют базу. */
export const messages = mergeDictionaries(baseMessages.ru, ru);

export type Messages = typeof messages;
export type MessageKey = keyof Messages & string;
export type MessageParams = Params;

/** Пока один язык (ru). Экземпляр нужен дизайн-системе (`configureDesignSystem({ i18n })`). */
export const i18n = createI18n({ baseLocale: 'ru', base: messages });

/**
 * Имя языка на самом языке — для экрана «Язык» (не переводится вместе с интерфейсом). Новый язык в `translations` —
 * сюда же; полноту проверяет тест.
 */
export const localeNames: Readonly<Record<string, string>> = { ru: 'Русский' };

/** Ключи типизированы: опечатка в ключе — ошибка typecheck. */
export function t(key: MessageKey, params?: MessageParams): string {
  return i18n.t(key, params);
}

export { interpolate } from '@rkarakulov/i18n-core';
