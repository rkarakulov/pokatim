/**
 * Версия алгоритма сверки — пишется в попытку. Любое изменение порогов, привязки, ворот или округления → +1 и новые
 * эталоны `__fixtures__/corridor/corridor-expected.json` (тест-сторож сравнивает версию).
 */
export const CORRIDOR_ENGINE_VERSION = 1;

/** Пороги сверки (часть версии 1). Расстояния — м, время — мс. */
export const CORRIDOR_POLICY = {
  /** отрезок линии маршрута длиннее — делится равномерно */
  densifyStepM: 25,
  /** ячейка сеточного индекса отрезков */
  gridCellM: 200,
  /** радиус поиска отрезков-кандидатов вокруг точки */
  searchRadius: (widthM: number) => Math.max(3 * widthM, 150),
  /** радиус ворот старта и финиша */
  gateRadius: (widthM: number) => Math.max(widthM, 30),
  /** ячейка покрытия маршрута */
  coverageCellM: 250,
  /** доля покрытых ячеек для финиша и зачёта */
  coverageMin: 0.98,
  /** больше непокрытых ячеек подряд (> 500 м) — `missed_section` */
  maxUncoveredCells: 2,
  /** A6: доля трека сегмента вне коридора, строго больше — `off_corridor` */
  maxOffCorridorShare: 0.02,
  /** A6: один непрерывный выход, строго больше — `off_corridor` */
  maxExcursionM: 500,
  /** между соседними точками дальше — покрытие не интерполируется (разрыв GPS) */
  gapMaxM: 1000,
  /** точка, в которую и из которой скорость выше, — выброс */
  spikeSpeedMps: 30,
  /** выходы из ворот старта в пределах — схлопываются в последний */
  startDebounceMs: 60_000,
  maxStartCandidates: 20,
  /** вес расхождения пройденного по маршруту и по треку в стоимости привязки */
  matchLambda: 0.5,
  /** доля обратного хода, не меньше — `wrong_direction` */
  wrongDirectionShare: 0.5,
  /** `elapsedSec = Math.round(elapsedMs / 1000)` (A7); длины сегмента — целые метры до сравнения с порогами */
  rounding: 'round',
} as const;
