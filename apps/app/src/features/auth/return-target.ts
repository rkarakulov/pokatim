import { create } from 'zustand';

interface ReturnTarget {
  /** Путь, забранный у `return-path` сразу после входа; до выхода — ещё и цель гарда шагов онбординга. */
  path: string | null;
  /** Переход к пути уже выполнен (один раз за вход). */
  done: boolean;
}

/**
 * Цель возврата гостя после входа (корневой layout). Отдельно от `return-path`: путь нужен и после перехода — гард
 * шагов онбординга, снятый в том же рендере, иначе увёл бы на Главную поверх возврата.
 */
export const useReturnTarget = create<ReturnTarget>()(() => ({ path: null, done: false }));
