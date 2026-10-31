import { Injectable } from '@nestjs/common';

import { ProfileRepository } from './profile.repository';
import type { PublicRiderCard, RiderNameDirectory, RouteRideRiders } from './rider-names.port';

/** Реализация порта `RiderNameDirectory`: читает `profiles` только через `ProfileRepository`. Имена не логирует. */
@Injectable()
export class RiderNamesService implements RiderNameDirectory {
  constructor(private readonly repository: ProfileRepository) {}

  async publicNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    return this.repository.findPublicNames(unique);
  }

  async publicRiders(userIds: readonly string[]): Promise<Map<string, PublicRiderCard>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    return this.repository.findPublicRiders(unique);
  }

  async attributionNames(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    return this.repository.findAttributionNames(unique);
  }

  async routeRideRiders(userIds: readonly string[]): Promise<RouteRideRiders> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return { shares: new Set(), cards: new Map() };
    return this.repository.findRouteRideRiders(unique);
  }
}
