import { RegistrationUrl, type CalendarStartDetail } from '@pokatim/contracts';

/**
 * Ссылка на регистрацию у организатора для кнопки карточки: только безопасная (`RegistrationUrl` — та же схема, что
 * ввод панели: `https`, без учётных данных) и пока старт не прошёл (фаза — сервер, Q3/Q8). Публичный ответ формат
 * ссылки не гарантирует (`z.string()`), поэтому проверка повторяется здесь. Иначе — `null`: кнопки нет.
 */
export function registrationLink(start: CalendarStartDetail): string | null {
  if (start.phase === 'finished' || start.registrationUrl === null) return null;
  const url = RegistrationUrl.safeParse(start.registrationUrl);
  return url.success ? url.data : null;
}
