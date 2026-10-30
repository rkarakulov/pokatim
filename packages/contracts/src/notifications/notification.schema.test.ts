import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  ExpoPushToken,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  NotificationListQuery,
  NotificationPage,
  NotificationSettings,
  NotificationTargetView,
  NotificationView,
  PUSH_PLATFORMS,
  isWebPushEndpoint,
  RegisterPushToken,
  RegisterWebPushSubscription,
  RevokePushToken,
  RevokeWebPushSubscription,
  UnreadCount,
  WebPushConfig,
} from './notification.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const ID2 = '01890a5d-ac96-774b-bcce-b302099a8058';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];

const view = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  kind: 'ride_cancelled',
  group: 'rides',
  title: 'Райд отменён',
  body: '«Кофе-райд» 14 июня, 10:00 отменён.',
  createdAt: '2026-10-22T09:00:00.000Z',
  read: false,
  target: { type: 'ride', rideId: ID },
  ...overrides,
});

describe('справочники уведомлений (только в конец)', () => {
  it('порядок значений зафиксирован', () => {
    expect(NOTIFICATION_GROUPS).toEqual(['races', 'disputes', 'rides']);
    expect(NOTIFICATION_KINDS).toEqual([
      'result_counted',
      'result_rejected',
      'protocol_published',
      'protocol_disqualified',
      'protocol_restored',
      'protocol_rechecked',
      'dispute_filed',
      'dispute_withdrawn',
      'dispute_responded',
      'dispute_decided',
      'ride_cancelled',
      'ride_rescheduled',
      'ride_joined',
      'ride_report_resolved',
      'route_published',
      'route_rejected',
      'profile_name_reset',
      'profile_avatar_reset',
      'profile_club_reset',
    ]);
    expect(PUSH_PLATFORMS).toEqual(['ios', 'android']);
  });
});

describe('ответы (tolerantEnum, неизвестная цель)', () => {
  it('известные цели разбираются как есть', () => {
    expect(NotificationTargetView.parse({ type: 'race', raceId: ID })).toEqual({
      type: 'race',
      raceId: ID,
    });
    expect(
      NotificationTargetView.parse({ type: 'dispute-response', raceId: ID, disputeId: ID2 }),
    ).toEqual({ type: 'dispute-response', raceId: ID, disputeId: ID2 });
    expect(NotificationTargetView.parse({ type: 'my-route', routeId: ID })).toEqual({
      type: 'my-route',
      routeId: ID,
    });
    expect(NotificationTargetView.parse({ type: 'profile-edit' })).toEqual({
      type: 'profile-edit',
    });
  });

  it('незнакомый тип цели или битый id — unknown, ответ не падает', () => {
    expect(NotificationTargetView.parse({ type: 'season', seasonId: ID })).toEqual({
      type: 'unknown',
    });
    expect(NotificationTargetView.parse({ type: 'race', raceId: 'https://evil.test' })).toEqual({
      type: 'unknown',
    });
  });

  it('незнакомые kind и group — unknown; цель null допустима', () => {
    const parsed = NotificationView.parse(view({ kind: 'season_rank', group: 'seasons' }));
    expect(parsed.kind).toBe('unknown');
    expect(parsed.group).toBe('unknown');
    expect(NotificationView.parse(view({ target: null })).target).toBeNull();
  });

  it('страница и счётчик', () => {
    expect(NotificationPage.parse({ items: [view()], nextCursor: null }).items).toHaveLength(1);
    expect(UnreadCount.parse({ count: 100 })).toEqual({ count: 100 });
    expect(UnreadCount.safeParse({ count: 101 }).success).toBe(false);
    expect(UnreadCount.safeParse({ count: -1 }).success).toBe(false);
  });
});

describe('запрос списка', () => {
  it('limit по умолчанию 20, строка из query приводится, 1–50', () => {
    expect(NotificationListQuery.parse({})).toEqual({ limit: 20 });
    expect(NotificationListQuery.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    expect(NotificationListQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(NotificationListQuery.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('лишние ключи — ошибка', () => {
    expect(NotificationListQuery.safeParse({ userId: ID }).success).toBe(false);
  });
});

describe('настройки', () => {
  it('умолчания: всё включено, тихие часы 22–8', () => {
    expect(NotificationSettings.parse(DEFAULT_NOTIFICATION_SETTINGS)).toEqual({
      push: { races: true, disputes: true, rides: true },
      email: { disputes: true, rides: true },
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    });
  });

  it('начало равно концу — INVALID на quietHours.endHour', () => {
    const result = NotificationSettings.safeParse({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      quietHours: { enabled: false, startHour: 7, endHour: 7 },
    });
    expect(codesOf(result)).toEqual(['quietHours.endHour:INVALID']);
  });

  it('часы 0–23, целые; полный объект; лишние ключи — ошибка', () => {
    const withHours = (startHour: unknown, endHour: unknown) =>
      NotificationSettings.safeParse({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        quietHours: { enabled: true, startHour, endHour },
      }).success;
    expect(withHours(0, 23)).toBe(true);
    expect(withHours(23, 0)).toBe(true);
    expect(withHours(24, 8)).toBe(false);
    expect(withHours(-1, 8)).toBe(false);
    expect(withHours(1.5, 8)).toBe(false);
    expect(withHours('22', 8)).toBe(false);
    expect(
      NotificationSettings.safeParse({ push: DEFAULT_NOTIFICATION_SETTINGS.push }).success,
    ).toBe(false);
    expect(
      NotificationSettings.safeParse({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        email: { ...DEFAULT_NOTIFICATION_SETTINGS.email, races: true },
      }).success,
    ).toBe(false);
  });
});

describe('push-токены', () => {
  it('формат Expo: ExpoPushToken[…] и ExponentPushToken[…]', () => {
    expect(ExpoPushToken.safeParse(TOKEN).success).toBe(true);
    expect(ExpoPushToken.safeParse('ExpoPushToken[abcdefghij_-12]').success).toBe(true);
  });

  it.each([
    ['пусто', ''],
    ['короткий', 'ExpoPushToken[abc]'],
    ['чужой префикс', 'FcmToken[xxxxxxxxxxxxxxxx]'],
    ['без скобки', 'ExpoPushToken[xxxxxxxxxxxxxxxx'],
    ['символы вне алфавита', 'ExpoPushToken[xxxxxxxx$xxxxxxx]'],
    ['перевод строки', `${TOKEN}\n`],
    ['длиннее 220', `ExpoPushToken[${'x'.repeat(210)}]`],
  ])('%s — ошибка', (_name, token) => {
    expect(ExpoPushToken.safeParse(token).success).toBe(false);
  });

  it('регистрация: токен и платформа ios|android; лишние ключи — ошибка', () => {
    expect(RegisterPushToken.parse({ token: TOKEN, platform: 'ios' })).toEqual({
      token: TOKEN,
      platform: 'ios',
    });
    expect(RegisterPushToken.safeParse({ token: TOKEN, platform: 'web' }).success).toBe(false);
    expect(
      RegisterPushToken.safeParse({ token: TOKEN, platform: 'android', userId: ID }).success,
    ).toBe(false);
  });

  it('снятие: только токен', () => {
    expect(RevokePushToken.parse({ token: TOKEN })).toEqual({ token: TOKEN });
    expect(RevokePushToken.safeParse({ token: TOKEN, platform: 'ios' }).success).toBe(false);
    expect(RevokePushToken.safeParse({ token: { $ne: null } }).success).toBe(false);
  });
});

describe('web push (ADR-0022)', () => {
  const P256DH = `B${'A'.repeat(86)}`;
  const AUTH = 'A'.repeat(22);
  const FCM = 'https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y';

  it.each([
    FCM,
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://api.push.apple.com/3/device/x',
  ])('endpoint push-сервиса %s — ок', (endpoint) => {
    expect(isWebPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['http', 'http://fcm.googleapis.com/fcm/send/x'],
    ['чужой хост', 'https://evil.example.com/fcm/send/x'],
    ['хост-приманка', 'https://fcm.googleapis.com.evil.com/x'],
    ['суффикс без точки', 'https://evilpush.apple.com/x'],
    ['порт', 'https://fcm.googleapis.com:8443/x'],
    ['учётные данные', 'https://user:pw@fcm.googleapis.com/x'],
    ['внутренний адрес', 'https://127.0.0.1/x'],
    ['не URL', 'fcm.googleapis.com/x'],
    ['обратный слеш', 'https://fcm.googleapis.com\\@evil.com/x'],
    ['без пути', 'https://fcm.googleapis.com'],
    ['пробел в пути', 'https://fcm.googleapis.com/a b'],
  ])('%s — нет', (_name, endpoint) => {
    expect(isWebPushEndpoint(endpoint)).toBe(false);
  });

  it('подписка: endpoint и ключи точной длины; лишние ключи и expirationTime — ошибка', () => {
    const body = { endpoint: FCM, keys: { p256dh: P256DH, auth: AUTH } };
    expect(RegisterWebPushSubscription.parse(body)).toEqual(body);
    expect(RegisterWebPushSubscription.safeParse({ ...body, expirationTime: null }).success).toBe(
      false,
    );
    expect(RegisterWebPushSubscription.safeParse({ ...body, userId: ID }).success).toBe(false);
    expect(
      RegisterWebPushSubscription.safeParse({
        ...body,
        keys: { p256dh: `A${P256DH.slice(1)}`, auth: AUTH },
      }).success,
    ).toBe(false);
    expect(
      RegisterWebPushSubscription.safeParse({ ...body, keys: { p256dh: P256DH, auth: `${AUTH}A` } })
        .success,
    ).toBe(false);
    expect(
      RegisterWebPushSubscription.safeParse({
        ...body,
        keys: { p256dh: P256DH, auth: `${AUTH.slice(1)}=` },
      }).success,
    ).toBe(false);
    expect(
      RegisterWebPushSubscription.safeParse({ ...body, endpoint: `${FCM}/${'x'.repeat(2048)}` })
        .success,
    ).toBe(false);
  });

  it('снятие — только endpoint из белого списка', () => {
    expect(RevokeWebPushSubscription.parse({ endpoint: FCM })).toEqual({ endpoint: FCM });
    expect(RevokeWebPushSubscription.safeParse({ endpoint: 'https://x.test/' }).success).toBe(
      false,
    );
    expect(RevokeWebPushSubscription.safeParse({ endpoint: { $ne: null } }).success).toBe(false);
  });

  it('конфиг: ключ или null', () => {
    expect(WebPushConfig.parse({ publicKey: P256DH })).toEqual({ publicKey: P256DH });
    expect(WebPushConfig.parse({ publicKey: null })).toEqual({ publicKey: null });
    expect(WebPushConfig.safeParse({ publicKey: 'short' }).success).toBe(false);
  });
});
