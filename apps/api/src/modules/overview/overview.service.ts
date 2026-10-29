import { Inject, Injectable } from '@nestjs/common';
import type { PanelOverview, Permission } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { CalendarOverview } from '../calendar';
import { DisputesOverview } from '../disputes';
import { IdentityOverview } from '../identity';
import type { PanelPrincipal } from '../panel';
import { ProfilesOverview } from '../profile';
import { RacesOverview } from '../races';
import { ResultsOverview } from '../results';
import { RidesOverview } from '../rides';
import { RoutesOverview } from '../routes';
import { TracksOverview } from '../tracks';
import { OVERVIEW_POLICY } from './overview.policy';

/**
 * «Обзор» панели (admin-overview) — композиция портов модулей-владельцев, своих коллекций нет. Блок без права не
 * считается и не отдаётся (поле отсутствует); гонки — с видимостью панели (организатор — только свои).
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly disputes: DisputesOverview,
    private readonly races: RacesOverview,
    private readonly results: ResultsOverview,
    private readonly rides: RidesOverview,
    private readonly routes: RoutesOverview,
    private readonly profiles: ProfilesOverview,
    private readonly identity: IdentityOverview,
    private readonly tracks: TracksOverview,
    private readonly calendar: CalendarOverview,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async overview(principal: PanelPrincipal): Promise<PanelOverview> {
    const now = this.clock.now();
    const when = <T>(permission: Permission, read: () => Promise<T>): Promise<T | undefined> =>
      principal.permissions.includes(permission) ? read() : Promise.resolve(undefined);
    const since = new Date(now.getTime() - OVERVIEW_POLICY.kpiPeriodMs);

    const [disputes, protocols, rides, riderRoutes, riderProfiles, accountDeletions, live, kpi] =
      await Promise.all([
        when('disputes.read', async () => ({ open: await this.disputes.openCount() })),
        when('races.read', () => this.protocols(principal, now)),
        when('rides.moderate', async () => ({ reported: await this.rides.reportedCount() })),
        when('routes.moderate', () => this.routes.moderationCounts()),
        when('profiles.moderate', async () => ({
          reported: await this.profiles.reportedCount(),
        })),
        when('platform.stats', async () => ({
          stuck: await this.identity.stuckDeletions(
            new Date(now.getTime() - OVERVIEW_POLICY.stuckDeletionMs),
          ),
        })),
        when('races.read', () => this.live(principal, now)),
        when('platform.stats', async () => {
          const [newUsers, uploads, activeRides] = await Promise.all([
            this.identity.createdSince(since),
            this.tracks.uploadsSince(since),
            this.rides.upcomingCount(now),
          ]);
          return { newUsers, uploads, activeRides };
        }),
      ]);
    return {
      attention: { disputes, protocols, rides, riderRoutes, riderProfiles, accountDeletions },
      live,
      kpi,
    };
  }

  private async protocols(principal: PanelPrincipal, now: Date) {
    const awaiting = await this.races.awaitingProtocol(principal, now, OVERVIEW_POLICY.racesLimit);
    const readiness = await this.results.protocolReadiness(awaiting.races, now);
    return { awaiting: awaiting.total, ...readiness };
  }

  private async live(principal: PanelPrincipal, now: Date) {
    const [open, calendar] = await Promise.all([
      this.races.openWindow(principal, now, OVERVIEW_POLICY.racesLimit),
      this.calendar.upcoming(now, OVERVIEW_POLICY.calendarLimit),
    ]);
    const activity = await this.results.raceActivity(open.races.map((race) => race.id));
    return {
      racesTotal: open.total,
      races: open.races.map((race) => ({
        id: race.id,
        title: race.title,
        windowEndsAt: race.windowEndsAt.toISOString(),
        participants: activity.get(race.id)?.participants ?? 0,
        attempts: activity.get(race.id)?.attempts ?? 0,
      })),
      calendar,
    };
  }
}
