import { describe, expect, it } from 'vitest';

import { buildOutboxRoutes, subscriberOutboxRoutes, workerOutboxRoutes } from './outbox-routes';

const queuesOf = (route: string | readonly string[] | undefined): readonly string[] =>
  route === undefined ? [] : typeof route === 'string' ? [route] : route;

describe('buildOutboxRoutes', () => {
  it('тип у двух подписчиков — обе очереди (fan-out), а не последний подписчик, как у spread', () => {
    const routes = buildOutboxRoutes([
      {
        'results.protocol-published': 'notifications-intake',
        'tracks.activity-ready': 'results-intake',
      },
      { 'results.protocol-published': 'standings-recalc' },
    ]);
    expect(routes['results.protocol-published']).toEqual([
      'notifications-intake',
      'standings-recalc',
    ]);
    expect(queuesOf(routes['tracks.activity-ready'])).toEqual(['results-intake']);
  });
});

describe('workerOutboxRoutes', () => {
  it('каждый подписчик каждого типа получает задачу: маршрут не затёрт другим подписчиком', () => {
    for (const routes of subscriberOutboxRoutes) {
      for (const [type, route] of Object.entries(routes)) {
        for (const queue of queuesOf(route)) {
          expect(queuesOf(workerOutboxRoutes[type]), `${type} → ${queue}`).toContain(queue);
        }
      }
    }
  });

  it('лишних маршрутов нет: каждый тип и очередь объявил подписчик', () => {
    for (const [type, route] of Object.entries(workerOutboxRoutes)) {
      for (const queue of queuesOf(route)) {
        expect(
          subscriberOutboxRoutes.some((routes) => queuesOf(routes[type]).includes(queue)),
          `${type} → ${queue}`,
        ).toBe(true);
      }
    }
  });

  it('события протокола results — и уведомлениям, и рейтингу сезона (standings-outbox-events, AC1)', () => {
    for (const type of ['results.protocol-published', 'results.result-revised']) {
      expect(queuesOf(workerOutboxRoutes[type])).toEqual([
        'notifications-intake',
        'standings-recalc',
      ]);
    }
  });

  it('активность: activity-ready — только results-intake, activity-group-created — только route-ride-auto (route-rides-03, AC4)', () => {
    expect(queuesOf(workerOutboxRoutes['tracks.activity-ready'])).toEqual(['results-intake']);
    expect(queuesOf(workerOutboxRoutes['tracks.activity-group-created'])).toEqual([
      'route-ride-auto',
    ]);
  });

  it('у каждого типа есть очередь', () => {
    for (const route of Object.values(workerOutboxRoutes)) {
      expect(queuesOf(route).length).toBeGreaterThan(0);
    }
  });
});
