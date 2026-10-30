/**
 * Порт `riders` для модуля `sharing` (OG-картинка профиля райдера, og-rider-season-dark, через
 * `modules/riders/index.ts`): публичная статистика профиля — только пока профиль публичен (имя + согласие). Имени,
 * клуба, фото и `userId` в типе нет (D-B2): картинку кэшируют мессенджеры, согласие можно отозвать.
 */
export const RIDERS_FOR_SHARING = Symbol('RIDERS_FOR_SHARING');

/** Факты картинки — статистика публичного профиля (та же сводка `summarize`, что у `GET /v1/riders/:publicId`). */
export interface RiderOgFacts {
  publicId: string;
  /** гонки с финишем (`finishes` сводки, RC-3a): «в зачёте» и финиши без места */
  races: number;
  /** места 1–3 */
  podiums: number;
  /** лучшее место; нет мест — `null` */
  bestPlace: number | null;
}

export interface RidersForSharing {
  /** Только публичный профиль (имя + согласие), иначе (нет, без имени, без согласия) — `null`. */
  ogFacts(publicId: string): Promise<RiderOgFacts | null>;
}
