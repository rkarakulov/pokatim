import { RegistrationUrl, type CalendarStartDetail } from '@pokatim/contracts';

/**
 * Ссылка регистрации безопасна (`RegistrationUrl` — та же схема, что ввод панели: `https`, без учётных данных).
 * Публичный ответ формат ссылки не гарантирует (`z.string()`), поэтому проверка повторяется на клиенте — одно
 * условие для строки «Регистрация у организатора.» на героях и для кнопки карточки.
 */
export function isRegistrationUrl(url: string | null): url is string {
  return url !== null && RegistrationUrl.safeParse(url).success;
}

/**
 * Ссылка для кнопки карточки: безопасная и пока старт не прошёл (фаза — сервер, Q3/Q8). Иначе — `null`: кнопки нет.
 */
export function registrationLink(start: CalendarStartDetail): string | null {
  if (start.phase === 'finished' || !isRegistrationUrl(start.registrationUrl)) return null;
  return RegistrationUrl.parse(start.registrationUrl);
}
