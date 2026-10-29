import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { type AppThemeId, DEFAULT_APP_THEME_ID, type OgCardKind } from '@pokatim/contracts';

import { CALENDAR_FOR_SHARING, type CalendarForSharing, type CalendarOgFacts } from '../calendar';
import { type RaceOgFacts, RACES_FOR_SHARING, type RacesForSharing } from '../races';
import { type RideInviteFacts, RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { type RouteOgFacts, ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { OG_CARD_POLICY } from './sharing.policy';

/** Вид картинки: 4 вида объектов и бренд-картинка (`OG_BRAND`). */
export type OgCardKindOrBrand = OgCardKind | 'brand';

/**
 * Тема OG-картинки — «Классика»: картинку видят гости и краулеры, а гость — в «Классике» (user-theme, ADR-0021;
 * глобальной активной темы больше нет). Входит в хэш и в отметку полного прохода `og.sync`.
 */
export const OG_THEME_ID: AppThemeId = DEFAULT_APP_THEME_ID;

/** Всё, от чего зависит OG-картинка (линию представляет `routeId` фактов: готовый маршрут неизменен). */
export type OgCardInput =
  | { kind: 'race'; themeId: AppThemeId; facts: RaceOgFacts }
  | { kind: 'ride'; themeId: AppThemeId; facts: RideInviteFacts }
  | { kind: 'route'; themeId: AppThemeId; facts: RouteOgFacts }
  | { kind: 'calendar'; themeId: AppThemeId; facts: CalendarOgFacts }
  | { kind: 'brand'; themeId: AppThemeId };

/** Входы, хэш (ключ PNG в Redis) и версия (часть URL). */
export interface ResolvedOgCard {
  input: OgCardInput;
  hash: string;
  version: string;
}

/** Поля карточки по виду — только то, что попадает на картинку, и ссылка на линию. */
function canonicalFacts(input: OgCardInput): unknown[] {
  switch (input.kind) {
    case 'race': {
      const f = input.facts;
      return [
        f.raceId,
        f.title,
        f.windowStartsAt.toISOString(),
        f.windowEndsAt.toISOString(),
        f.distanceKm,
        f.bikeClass,
        f.routeId,
      ];
    }
    case 'ride': {
      const f = input.facts;
      return [
        f.rideId,
        f.title,
        f.startsAt.toISOString(),
        f.place,
        f.distanceKm,
        f.paceMinKmh,
        f.paceMaxKmh,
        f.routeId,
      ];
    }
    case 'route': {
      const f = input.facts;
      return [f.routeId, f.title, f.distanceM, f.elevationGainM, f.isLoop, f.city, f.routeId];
    }
    case 'calendar': {
      const f = input.facts;
      return [f.startId, f.title, f.startsOn, f.endsOn, f.city, f.distancesKm, null];
    }
    case 'brand':
      return [];
  }
}

/**
 * Ключ PNG: sha256 hex канонического JSON (префикс OG, вид, версия рендера, тема, поля карточки вида, ссылка на
 * публичную линию). Смена любого поля — новый хэш и новый URL картинки.
 */
export function ogCardHash(input: OgCardInput): string {
  const canonical = [
    'og',
    input.kind,
    OG_CARD_POLICY.renderVersion,
    input.themeId,
    ...canonicalFacts(input),
  ];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Версия в URL картинки — первые 16 hex хэша. */
export const ogCardVersion = (hash: string) => hash.slice(0, 16);

const resolved = (input: OgCardInput): ResolvedOgCard => {
  const hash = ogCardHash(input);
  return { input, hash, version: ogCardVersion(hash) };
};

/**
 * Входы OG-картинки — одна реализация для HTTP (версия, выдача), `og.sync` и worker (сверка «устарело»): публичные
 * факты через порты владельцев (`null` — объект не публичный) и тема `OG_THEME_ID`.
 */
@Injectable()
export class OgCardInputs {
  constructor(
    @Inject(RACES_FOR_SHARING) private readonly races: RacesForSharing,
    @Inject(RIDES_FOR_SHARING) private readonly rides: RidesForSharing,
    @Inject(ROUTES_FOR_SHARING) private readonly routes: RoutesForSharing,
    @Inject(CALENDAR_FOR_SHARING) private readonly calendar: CalendarForSharing,
  ) {}

  async resolve(kind: OgCardKind, id: string): Promise<ResolvedOgCard | null> {
    const themeId = OG_THEME_ID;
    switch (kind) {
      case 'race': {
        const facts = await this.races.ogFacts(id);
        return facts ? resolved({ kind, themeId, facts }) : null;
      }
      case 'ride': {
        const facts = await this.rides.ogFacts(id);
        return facts ? resolved({ kind, themeId, facts }) : null;
      }
      case 'route': {
        const facts = await this.routes.ogFacts(id);
        return facts ? resolved({ kind, themeId, facts }) : null;
      }
      case 'calendar': {
        const facts = await this.calendar.ogFacts(id);
        return facts ? resolved({ kind, themeId, facts }) : null;
      }
    }
  }

  resolveBrand(): ResolvedOgCard {
    return resolved({ kind: 'brand', themeId: OG_THEME_ID });
  }

  /** Строки, изменившиеся после курсора, — порт владельца вида (`og.sync`). */
  changed(
    kind: OgCardKind,
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]> {
    const ports = {
      race: this.races,
      ride: this.rides,
      route: this.routes,
      calendar: this.calendar,
    } as const;
    return ports[kind].ogChanged(after, limit);
  }
}
