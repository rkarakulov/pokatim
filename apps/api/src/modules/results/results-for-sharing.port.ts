import type { LonLat, ResultGroupKey } from '@pokatim/contracts';

/**
 * Порт `results` для модуля `sharing` (story-cards, через `modules/results/index.ts`): факты своего результата для
 * карточки для сторис и её линия. `sharing` коллекций `race_entries`/`race_attempts`/`activity_tracks` не читает.
 */
export const RESULTS_FOR_SHARING = Symbol('RESULTS_FOR_SHARING');

/** Статусы результата с карточкой (`storyCardEligible`). */
export type StoryCardResultStatus = 'provisional' | 'finisher' | 'final' | 'revised';

/** Факты карточки — как «моё участие» (`ResultsReadService.entryResult`), без координат. */
export interface StoryCardFacts {
  entryId: string;
  race: { title: string; windowStartsAt: Date; windowEndsAt: Date; routeId: string | null };
  status: StoryCardResultStatus;
  elapsedSec: number;
  /** `null` — без места (`finisher`) */
  place: number | null;
  tied: boolean;
  group: ResultGroupKey;
  /**
   * Попытка результата: строка текущей ревизии протокола (опубликован) или `best` заявки. Разметка — для ключа кэша
   * карточки, координат нет. `null` — попытки нет (документ удалён).
   */
  attempt: {
    id: string;
    checkRevision: number;
    segment: [number, number] | null;
    linePoints: number | null;
  } | null;
}

/** Линия карточки: отрезок своей попытки между воротами (`attempt`) или линия маршрута гонки (`route`). */
export interface StoryCardLine {
  kind: 'attempt' | 'route';
  line: LonLat[];
}

export interface ResultsForSharing {
  /**
   * Факты карточки своей заявки. Гонки нет (черновик, неизвестна) — 404 `NOT_FOUND`; заявки нет или
   * `!storyCardEligible` — `null`. Одна snapshot-сессия (заявка, место и попытка согласованы).
   */
  storyCardFacts(userId: string, raceId: string): Promise<StoryCardFacts | null>;
  /**
   * Линия карточки (только worker): попытка `counted` с разметкой `trackMap.segment` и `linePoints` = длине
   * сохранённой линии — `{ kind: 'attempt', line: sliceLine(line, from, to) }` (точек до ворот старта и после финиша
   * нет); иначе линия показа маршрута гонки (`kind: 'route'`); нет и её — `null`. Сырую линию активности наружу не
   * отдаёт никогда.
   */
  storyCardLine(userId: string, facts: StoryCardFacts): Promise<StoryCardLine | null>;
}
