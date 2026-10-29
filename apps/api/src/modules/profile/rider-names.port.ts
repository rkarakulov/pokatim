/**
 * Порт `profile` (через `modules/profile/index.ts`): `results` — публичные имена только с согласием (P1); `routes`
 * (routes-06) — имя автора маршрута каталога, согласие — галочка заявки маршрута.
 */
export const RIDER_NAMES = Symbol('RIDER_NAMES');

/** Публичный райдер строки таблицы (rider-links-in-tables): имя, ссылка на профиль и фото. */
export interface PublicRiderCard {
  name: string;
  /** выдаётся при первом «имя + согласие» (R4); у профиля до бэкфилла может не быть — `null` */
  publicId: string | null;
  avatarId: string | null;
}

/**
 * Поля строки публичной таблицы из карточки порта (rider-links-in-tables): нет карточки (нет имени или согласия) —
 * все `null` («Участник» без ссылки и фото). Явный список полей — `userId` сюда не попадает.
 */
export function riderRowFields(card: PublicRiderCard | undefined): {
  riderName: string | null;
  riderPublicId: string | null;
  riderAvatar: { id: string } | null;
} {
  return {
    riderName: card?.name ?? null,
    riderPublicId: card?.publicId ?? null,
    riderAvatar: card?.avatarId ? { id: card.avatarId } : null,
  };
}

export interface RiderNameDirectory {
  /** Только `publicName !== null && showNameInResults === true`; пустой вход — пустая карта без запроса. */
  publicNames(userIds: readonly string[]): Promise<Map<string, string>>;
  /**
   * Публичные таблицы (результаты, финишёры, рейтинг сезона): условие то же, что у `publicNames` (в фильтре запроса);
   * пустой вход — пустая карта без запроса.
   */
  publicRiders(userIds: readonly string[]): Promise<Map<string, PublicRiderCard>>;
  /**
   * Имя автора маршрута (routes-06, U3): `publicName` — строка, **без** условия `showNameInResults` (согласие —
   * `publication.showAuthorName` заявки); пустой вход — пустая карта без запроса. Читается на каждом запросе каталога.
   */
  attributionNames(userIds: readonly string[]): Promise<Map<string, string>>;
}
