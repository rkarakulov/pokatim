import {
  BikeClass,
  DistanceKm,
  minskWallTimeToUtc,
  type PanelRace,
  RACE_FIELDS,
  RACE_PROTOCOL_MIN_DELAY_HOURS,
  RaceInput,
  type RaceField,
  RaceTitle,
  utcToMinskWallTime,
} from '@pokatim/contracts';
import { z } from 'zod';

/** Настенное время Минска из `<input type="datetime-local">`. */
const WallTime = z
  .string({ error: 'REQUIRED' })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, { error: 'INVALID_DATE' });

/**
 * Значения формы гонки: поля — схемы контракта (`RaceTitle`, `BikeClass`, покрытия `RaceInput`, `DistanceKm`), моменты —
 * настенное время Минска (в запрос — `minskWallTimeToUtc`), дистанция — строка поля ввода (запятая допустима).
 */
export const RaceFormSchema = z.object({
  title: RaceTitle,
  bikeClass: BikeClass,
  surfaces: RaceInput.shape.surfaces,
  distanceKm: z
    .string()
    .trim()
    .min(1, { error: 'REQUIRED', abort: true })
    .transform((value) => Number(value.replace(',', '.')))
    .pipe(DistanceKm),
  description: z.string(),
  windowStartsAt: WallTime,
  windowEndsAt: WallTime,
  protocolPlannedAt: WallTime,
});
export type RaceFormValues = z.input<typeof RaceFormSchema>;
export type RaceFormOutput = z.output<typeof RaceFormSchema>;

export const emptyRaceForm = (): RaceFormValues => ({
  title: '',
  bikeClass: 'road',
  surfaces: [],
  distanceKm: '',
  description: '',
  windowStartsAt: '',
  windowEndsAt: '',
  protocolPlannedAt: '',
});

/** Значения формы из гонки панели (моменты — настенное время Минска). */
export function raceFormOf(race: PanelRace): RaceFormValues {
  return {
    title: race.title,
    bikeClass: race.bikeClass,
    surfaces: race.surfaces,
    distanceKm: String(race.distanceKm),
    description: race.description ?? '',
    windowStartsAt: utcToMinskWallTime(race.windowStartsAt),
    windowEndsAt: utcToMinskWallTime(race.windowEndsAt),
    protocolPlannedAt: utcToMinskWallTime(race.protocolPlannedAt),
  };
}

/** Тело запроса из значений формы: моменты — UTC через функцию контрактов (не пояс браузера). */
export function raceInputOf(values: RaceFormOutput): RaceInput {
  return {
    title: values.title,
    bikeClass: values.bikeClass,
    surfaces: values.surfaces,
    distanceKm: values.distanceKm,
    description: values.description.trim() === '' ? null : values.description.trim(),
    windowStartsAt: minskWallTimeToUtc(values.windowStartsAt),
    windowEndsAt: minskWallTimeToUtc(values.windowEndsAt),
    protocolPlannedAt: minskWallTimeToUtc(values.protocolPlannedAt),
  };
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : a === b;

/** Изменённые и разрешённые сервером (`editable.fields`) поля — тело правки без версии. */
export function raceChanges(race: PanelRace, input: RaceInput): Partial<RaceInput> {
  const before: Record<RaceField, unknown> = {
    title: race.title,
    bikeClass: race.bikeClass,
    surfaces: race.surfaces,
    distanceKm: race.distanceKm,
    description: race.description,
    windowStartsAt: new Date(race.windowStartsAt).toISOString(),
    windowEndsAt: new Date(race.windowEndsAt).toISOString(),
    protocolPlannedAt: new Date(race.protocolPlannedAt).toISOString(),
  };
  const after: Record<RaceField, unknown> = {
    ...input,
    windowStartsAt: new Date(input.windowStartsAt).toISOString(),
    windowEndsAt: new Date(input.windowEndsAt).toISOString(),
    protocolPlannedAt: new Date(input.protocolPlannedAt).toISOString(),
  };
  const changes: Partial<Record<RaceField, unknown>> = {};
  for (const field of RACE_FIELDS) {
    if (race.editable.fields.includes(field) && !same(before[field], after[field])) {
      changes[field] = input[field];
    }
  }
  return changes as Partial<RaceInput>;
}

/** Ближайшая допустимая плановая дата протокола (подсказка; правило — сервер): конец окна + 48 ч, ISO UTC. */
export function earliestProtocol(windowEndsAtWall: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(windowEndsAtWall)) return undefined;
  try {
    const end = Date.parse(minskWallTimeToUtc(windowEndsAtWall));
    return new Date(end + RACE_PROTOCOL_MIN_DELAY_HOURS * 3_600_000).toISOString();
  } catch {
    return undefined;
  }
}

/** Настенное время → момент (мс) или `undefined` для неполного ввода. */
export function wallMs(wall: string): number | undefined {
  try {
    return Date.parse(minskWallTimeToUtc(wall));
  } catch {
    return undefined;
  }
}
