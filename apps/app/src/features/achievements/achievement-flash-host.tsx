import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { flashQueue } from './achievement-catalog';
import { hiddenKeys, resetShown } from './flash-session';
import { useAchievements } from './queries';

/** Путь полноэкранной вспышки (внутри `Stack.Protected` вкладок). */
export const FLASH_PATH = '/achievements/flash';

/**
 * Адреса, поверх которых вспышка не открывается: она сама, экран достижения, сторис (переход «Поделиться»), ссылки
 * писем, возврат авторизации устройства и удаление аккаунта (там решается сессия).
 */
const QUIET_PREFIXES = [
  '/achievements',
  '/races/story/',
  '/auth/',
  '/devices/return',
  '/settings/account/delete',
];

/**
 * Хост «Вспышки достижения» (A5, AC9): `ready` — вошёл и прошёл онбординг (как у push). Подписан на свои достижения:
 * запрос — на старте и при возврате приложения (`focusManager`, `staleTime` 60 с); есть неувиденное, не показанное
 * в этом запуске и не входившее в уже открытую очередь этого ответа сервера (`flash-session`) — открывает вспышку. Ошибка запроса — тишина (без баннеров и повторов на экране).
 * Рядом со `Stack` корневого layout: переход — после монтирования навигатора.
 */
export function AchievementFlashHost({ ready }: { ready: boolean }): null {
  const router = useRouter();
  const pathname = usePathname();
  const { data, dataUpdatedAt } = useAchievements(ready);
  const pending =
    ready && data !== undefined && flashQueue(data.items, hiddenKeys(dataUpdatedAt)).length > 0;
  const quiet = QUIET_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    // выход из аккаунта: показанное прежним аккаунтом не прячет вспышки следующего
    if (!ready) resetShown();
  }, [ready]);

  useEffect(() => {
    if (pending && !quiet) router.push(FLASH_PATH);
  }, [pending, quiet, router]);

  return null;
}
