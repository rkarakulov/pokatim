import { RIDER_PUBLIC_NAME_MIN } from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

/** Текст ошибки поля по коду (сообщение zod = код); `min` — предел поля; незнакомый код — «Проверьте значение». */
export function fieldText(
  code: string | undefined,
  min = RIDER_PUBLIC_NAME_MIN,
): string | undefined {
  if (code === undefined) return undefined;
  const key = `field.error.${code}` as MessageKey;
  const text = t(key, { min });
  return text === key ? t('field.error.INVALID') : text;
}
