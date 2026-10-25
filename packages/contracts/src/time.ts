import { z } from 'zod';

/**
 * Время платформы (ADR-0010, R4): в БД и API — UTC; ввод и показ — «настенное» время Минска. Перевод — только эти
 * функции (`Intl` и tz-база среды, без зависимостей): пояс браузера и устройства не участвует. `new Date(local)` и
 * сдвиг «+3 ч» по месту запрещены (`pokatim-contracts.md`).
 */
export const PLATFORM_TIME_ZONE = 'Europe/Minsk' as const;

/** Календарная дата `YYYY-MM-DD` (валидная: `2026-02-30` — ошибка). */
export const LocalDate = z.iso.date({ error: 'INVALID_DATE' });
export type LocalDate = z.infer<typeof LocalDate>;

/** Время суток `HH:mm` (00:00–23:59). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'INVALID' });
export type LocalTime = z.infer<typeof LocalTime>;

/** Месяц `YYYY-MM`. */
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'INVALID' });
export type YearMonth = z.infer<typeof YearMonth>;

/** Момент UTC с точностью до минуты: ISO только с `Z` (без смещения), секунды и миллисекунды — 0. */
export const UtcMinute = z.iso.datetime({ error: 'INVALID_DATE', abort: true }).refine(
  (value) => {
    const date = new Date(value);
    return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  },
  { error: 'INVALID_DATE' },
);
export type UtcMinute = z.infer<typeof UtcMinute>;

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const MINSK_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Настенное время Минска момента: `YYYY-MM-DDTHH:mm`. */
function minskWall(at: Date): string {
  const parts = MINSK_PARTS.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Настенное время как будто в UTC — миллисекунды эпохи (для вычисления смещения пояса). */
function wallAsUtcMs(wall: string): number {
  const match = WALL_TIME.exec(wall);
  if (!match) throw new RangeError(`ожидается YYYY-MM-DDTHH:mm: ${wall}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  // 2026-02-30T10:00 и 24:00 не нормализуются молча
  if (new Date(ms).toISOString().slice(0, 16) !== wall) {
    throw new RangeError(`несуществующее время: ${wall}`);
  }
  return ms;
}

/**
 * Настенное время Минска (`YYYY-MM-DDTHH:mm`, значение `<input type="datetime-local">`) → момент UTC
 * (`YYYY-MM-DDTHH:mm:00Z`). Смещение берётся из tz-базы на этот момент (смена правил пояса не требует правки кода).
 */
export function minskWallTimeToUtc(local: string): string {
  const target = wallAsUtcMs(local);
  // первое приближение — смещение пояса в момент «target как UTC», затем уточнение на найденном моменте
  let utc = target - (wallAsUtcMs(minskWall(new Date(target))) - target);
  utc = target - (wallAsUtcMs(minskWall(new Date(utc))) - utc);
  return `${new Date(utc).toISOString().slice(0, 16)}:00Z`;
}

/** Момент UTC (ISO) → настенное время Минска `YYYY-MM-DDTHH:mm`. */
export function utcToMinskWallTime(iso: string): string {
  return minskWall(new Date(iso));
}

/** Начало календарного дня Минска (00:00) как момент UTC. */
export function minskDayStartUtc(date: string): Date {
  return new Date(minskWallTimeToUtc(`${date}T00:00`));
}

/** Сегодняшняя календарная дата Минска `YYYY-MM-DD`. */
export function minskToday(now: Date = new Date()): string {
  return minskWall(now).slice(0, 10);
}

/** Календарная дата через `days` дней (без часового пояса). */
export function addLocalDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`ожидается YYYY-MM-DD: ${date}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}
