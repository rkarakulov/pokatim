import { createECDH } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { testEnv } from '../../test/test-env';
import { webPushVapid } from './env';

/** Пара VAPID, созданная тестом (ключей в репозитории нет). */
function vapidPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
    // приватный ключ — ровно 32 байта (ведущие нули getPrivateKey не отдаёт)
    VAPID_PRIVATE_KEY: Buffer.from(
      ecdh.getPrivateKey().toString('hex').padStart(64, '0'),
      'hex',
    ).toString('base64url'),
  };
}

describe('env', () => {
  it('APP_LINK_BASE: схема приложения или Expo Go, всегда с завершающим слешем', () => {
    expect(testEnv({ APP_LINK_BASE: 'pokatim://' }).APP_LINK_BASE).toBe('pokatim://');
    expect(testEnv({ APP_LINK_BASE: 'exp://127.0.0.1:8081/--/' }).APP_LINK_BASE).toBe(
      'exp://127.0.0.1:8081/--/',
    );
    expect(() => testEnv({ APP_LINK_BASE: 'exp://127.0.0.1:8081/--' })).toThrow();
  });

  it('секреты короче 32 символов не принимаются', () => {
    expect(() => testEnv({ JWT_SECRET: 'short' })).toThrow();
    expect(() => testEnv({ EMAIL_TOKEN_SECRET: 'short' })).toThrow();
  });

  it('почта: SMTP_URL — URL, MAIL_FROM — не пустой', () => {
    expect(testEnv().SMTP_URL).toBe('smtp://127.0.0.1:1025');
    expect(() => testEnv({ SMTP_URL: 'not a url' })).toThrow();
    expect(() => testEnv({ MAIL_FROM: '' })).toThrow();
  });

  it('CORS_ORIGINS: список origin через запятую; пусто — CORS выключен', () => {
    expect(testEnv().CORS_ORIGINS).toEqual([]);
    expect(testEnv({ CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([]);
    expect(
      testEnv({ CORS_ORIGINS: 'http://localhost:8081, https://app.example.com' }).CORS_ORIGINS,
    ).toEqual(['http://localhost:8081', 'https://app.example.com']);
  });

  it('CORS_ORIGINS: не origin (путь, «/» в конце, не URL) — ошибка', () => {
    expect(() => testEnv({ CORS_ORIGINS: 'https://app.example.com/path' })).toThrow();
    expect(() => testEnv({ CORS_ORIGINS: 'https://app.example.com/' })).toThrow();
    expect(() => testEnv({ CORS_ORIGINS: 'localhost:8081' })).toThrow();
    expect(() => testEnv({ CORS_ORIGINS: '*' })).toThrow();
  });

  it('адреса MongoDB и Redis обязательны и валидны', () => {
    expect(() => testEnv({ MONGO_URL: '' })).toThrow();
    expect(() => testEnv({ MONGO_URL: 'postgres://127.0.0.1:5432/app' })).toThrow();
    expect(() => testEnv({ REDIS_URL: '' })).toThrow();
  });

  it('MONGO_URL: имя БД в пути обязательно (без него драйвер молча берёт БД test); multi-host — можно', () => {
    expect(() => testEnv({ MONGO_URL: 'mongodb://127.0.0.1:27017' })).toThrow();
    expect(() => testEnv({ MONGO_URL: 'mongodb://127.0.0.1:27017/?replicaSet=rs0' })).toThrow();
    const multiHost = 'mongodb://user:secret@db1:27017,db2:27017/app?replicaSet=rs0&tls=true';
    expect(testEnv({ MONGO_URL: multiHost }).MONGO_URL).toBe(multiHost);
    expect(testEnv({ MONGO_URL: 'mongodb+srv://cluster.example.net/app' }).MONGO_URL).toBe(
      'mongodb+srv://cluster.example.net/app',
    );
  });

  it('ошибка MONGO_URL не раскрывает значение (пароль)', () => {
    expect(() => testEnv({ MONGO_URL: 'mongodb://user:secret@db1:27017' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret') }),
    );
  });

  it('треки и устройства: значения по умолчанию — устройства выключены, стенд стартует без ключей OW', () => {
    const value = testEnv();
    expect(value.DEVICES_ENABLED).toBe(false);
    expect(value.DEVICE_PROVIDERS_ALLOWLIST).toEqual(['garmin', 'wahoo']);
    expect(value.DEVICES_SYNC_INTERVAL_MIN).toBe(15);
    expect(value.DEVICES_HISTORY_DAYS).toBe(30);
    expect(value.TRACK_STORAGE_MAX_BYTES).toBe(2 * 1024 ** 3);
    expect(value.OW_EXTERNAL_ID_PREFIX).toBe('pokatim:');
    expect(value.OW_SHARED_INSTANCE).toBe(false);
    expect(testEnv({ DEVICE_PROVIDERS_ALLOWLIST: 'wahoo' }).DEVICE_PROVIDERS_ALLOWLIST).toEqual([
      'wahoo',
    ]);
    expect(() => testEnv({ DEVICE_PROVIDERS_ALLOWLIST: 'garmin,strava' })).toThrow();
  });

  const devices = {
    DEVICES_ENABLED: 'true',
    OW_API_URL: 'http://open-wearables:8000',
    OW_API_KEY: 'ow-test-key-0000000000',
    PUBLIC_API_ORIGIN: 'https://api.example.com',
    DEVICE_RETURN_URLS: 'https://app.example.com/devices/return,pokatim://devices/return',
  };

  it('DEVICES_ENABLED=true без адреса/ключа OW, origin API или URL возврата — отказ запуска', () => {
    expect(testEnv(devices).DEVICE_RETURN_URLS).toEqual([
      'https://app.example.com/devices/return',
      'pokatim://devices/return',
    ]);
    expect(() => testEnv({ ...devices, OW_API_KEY: '' })).toThrow(/OW_API_KEY/);
    expect(() => testEnv({ ...devices, OW_API_URL: undefined })).toThrow(/OW_API_URL/);
    expect(() => testEnv({ ...devices, PUBLIC_API_ORIGIN: undefined })).toThrow(
      /PUBLIC_API_ORIGIN/,
    );
    expect(() => testEnv({ ...devices, DEVICE_RETURN_URLS: '' })).toThrow(/DEVICE_RETURN_URLS/);
    expect(() =>
      testEnv({ ...devices, PUBLIC_API_ORIGIN: 'https://api.example.com/v1' }),
    ).toThrow();
  });

  it('production: общий инстанс OW и exp:// в URL возврата — отказ запуска', () => {
    expect(() => testEnv({ NODE_ENV: 'production', OW_SHARED_INSTANCE: 'true' })).toThrow(
      /OW_SHARED_INSTANCE/,
    );
    expect(testEnv({ OW_SHARED_INSTANCE: 'true' }).OW_SHARED_INSTANCE).toBe(true);
    // dev-стенд — тоже NODE_ENV=production, но объявляет DEPLOY_STAGE=dev: общий OW разрешён
    expect(
      testEnv({ NODE_ENV: 'production', DEPLOY_STAGE: 'dev', OW_SHARED_INSTANCE: 'true' })
        .OW_SHARED_INSTANCE,
    ).toBe(true);
    expect(() =>
      testEnv({
        NODE_ENV: 'production',
        DEVICE_RETURN_URLS: 'exp://127.0.0.1:8081/--/devices/return',
      }),
    ).toThrow(/exp/);
  });

  it('секрет вебхука — только whsec_<base64>; ошибка не раскрывает ключ OW', () => {
    expect(() => testEnv({ OW_WEBHOOK_SECRET: 'plain-secret' })).toThrow();
    expect(
      testEnv({ OW_WEBHOOK_SECRET: `whsec_${Buffer.alloc(24, 1).toString('base64')}` })
        .OW_WEBHOOK_SECRET,
    ).toBeDefined();
    expect(() =>
      testEnv({ ...devices, OW_API_URL: 'ftp://x', OW_API_KEY: 'marker-key-0000000000' }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('marker-key') }));
  });

  it('пустые необязательные переменные в .env (шаблон деплоя) — как не заданные', () => {
    const value = testEnv({
      OW_API_URL: '',
      OW_API_KEY: '',
      OW_WEBHOOK_SECRET: '',
      PUBLIC_API_ORIGIN: '',
      DEVICE_RETURN_URLS: '',
    });
    expect(value.OW_API_KEY).toBeUndefined();
    expect(value.OW_WEBHOOK_SECRET).toBeUndefined();
    expect(value.DEVICES_ENABLED).toBe(false);
  });

  it('APP_WEB_ORIGIN (event-tickets): необязателен, только https-origin без пути; пусто — как не задан', () => {
    expect(testEnv().APP_WEB_ORIGIN).toBeUndefined();
    expect(testEnv({ APP_WEB_ORIGIN: '' }).APP_WEB_ORIGIN).toBeUndefined();
    expect(testEnv({ APP_WEB_ORIGIN: 'https://pokatim.example' }).APP_WEB_ORIGIN).toBe(
      'https://pokatim.example',
    );
    for (const bad of ['http://pokatim.example', 'https://pokatim.example/app', 'pokatim://']) {
      expect(() => testEnv({ APP_WEB_ORIGIN: bad }), bad).toThrow();
    }
  });

  it('уведомления: push выключен по умолчанию, ключа Expo нет, адрес — exp.host', () => {
    const value = testEnv();
    expect(value.PUSH_ENABLED).toBe(false);
    expect(value.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect(value.EXPO_PUSH_API_URL).toBe('https://exp.host/--/api/v2/push');
    expect(testEnv({ PUSH_ENABLED: 'true' }).PUSH_ENABLED).toBe(true);
    expect(testEnv({ EXPO_ACCESS_TOKEN: '' }).EXPO_ACCESS_TOKEN).toBeUndefined();
  });

  it('уведомления: ключ Expo — не короче 20 символов, ошибка его не раскрывает; адрес — http(s)', () => {
    expect(() => testEnv({ EXPO_ACCESS_TOKEN: 'short-expo-key' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('short-expo-key') }),
    );
    expect(testEnv({ EXPO_ACCESS_TOKEN: 'x'.repeat(40) }).EXPO_ACCESS_TOKEN).toHaveLength(40);
    expect(() => testEnv({ EXPO_PUSH_API_URL: 'ftp://exp.host/--/api/v2/push' })).toThrow();
    expect(testEnv({ EXPO_PUSH_API_URL: 'http://127.0.0.1:4010/push' }).EXPO_PUSH_API_URL).toBe(
      'http://127.0.0.1:4010/push',
    );
  });

  it('production: адрес Expo Push — только exp.host (dev-стенд — любой)', () => {
    expect(() =>
      testEnv({ NODE_ENV: 'production', EXPO_PUSH_API_URL: 'https://push.example.test/push' }),
    ).toThrow(/EXPO_PUSH_API_URL/);
    expect(
      testEnv({
        NODE_ENV: 'production',
        DEPLOY_STAGE: 'dev',
        EXPO_PUSH_API_URL: 'https://push.example.test/push',
      }).EXPO_PUSH_API_URL,
    ).toBe('https://push.example.test/push');
    expect(testEnv({ NODE_ENV: 'production' }).EXPO_PUSH_API_URL).toBe(
      'https://exp.host/--/api/v2/push',
    );
  });

  it('web push: выключен по умолчанию; включён — нужны пара ключей и subject', () => {
    expect(webPushVapid(testEnv())).toBeNull();
    const pair = vapidPair();
    const subject = { VAPID_SUBJECT: 'mailto:dev@pokatim.test' };
    expect(() => testEnv({ WEB_PUSH_ENABLED: 'true' })).toThrow(/WEB_PUSH_ENABLED=true/);
    expect(() => testEnv({ WEB_PUSH_ENABLED: 'true', ...pair })).toThrow(/VAPID_SUBJECT/);
    const value = testEnv({ WEB_PUSH_ENABLED: 'true', ...pair, ...subject });
    expect(webPushVapid(value)).toEqual({
      publicKey: pair.VAPID_PUBLIC_KEY,
      privateKey: pair.VAPID_PRIVATE_KEY,
      subject: 'mailto:dev@pokatim.test',
    });
    // ключи без флага — выключен
    expect(webPushVapid(testEnv({ ...pair, ...subject }))).toBeNull();
  });

  it('web push: ключи не пара или не того формата — отказ, приватный в ошибке не печатается', () => {
    const pair = vapidPair();
    const other = vapidPair();
    const base = { WEB_PUSH_ENABLED: 'true', VAPID_SUBJECT: 'https://pokatim.test' };
    expect(() => testEnv({ ...base, ...pair, VAPID_PUBLIC_KEY: other.VAPID_PUBLIC_KEY })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(pair.VAPID_PRIVATE_KEY) as unknown,
      }),
    );
    expect(() => testEnv({ ...base, ...pair, VAPID_PUBLIC_KEY: 'short' })).toThrow();
    expect(() => testEnv({ ...base, ...pair, VAPID_SUBJECT: 'dev@pokatim.test' })).toThrow();
  });

  it('web push: тестовый origin push-сервиса — только NODE_ENV=test', () => {
    expect(testEnv({ WEB_PUSH_TEST_ORIGIN: 'http://127.0.0.1:4011' }).WEB_PUSH_TEST_ORIGIN).toBe(
      'http://127.0.0.1:4011',
    );
    expect(() =>
      testEnv({ NODE_ENV: 'production', WEB_PUSH_TEST_ORIGIN: 'http://127.0.0.1:4011' }),
    ).toThrow(/WEB_PUSH_TEST_ORIGIN/);
  });

  it('2FA панели: по умолчанию ключа нет и 2FA не обязательна', () => {
    const value = testEnv();
    expect(value.PANEL_TOTP_KEY).toBeUndefined();
    expect(value.PANEL_TOTP_ENFORCED).toBe(false);
    expect(testEnv({ PANEL_TOTP_KEY: '' }).PANEL_TOTP_KEY).toBeUndefined();
  });

  it('2FA панели: ключ — hex 64 (32 байта), ошибка его не раскрывает', () => {
    const key = 'ab'.repeat(32);
    expect(testEnv({ PANEL_TOTP_KEY: key }).PANEL_TOTP_KEY).toBe(key);
    for (const bad of ['ab'.repeat(31), 'zz'.repeat(32), `${key}00`]) {
      expect(() => testEnv({ PANEL_TOTP_KEY: bad })).toThrow();
      expect(() => testEnv({ PANEL_TOTP_KEY: bad })).not.toThrow(bad);
    }
  });

  it('PANEL_TOTP_ENFORCED=true без ключа — отказ запуска; с ключом — можно', () => {
    expect(() => testEnv({ PANEL_TOTP_ENFORCED: 'true' })).toThrow(/PANEL_TOTP_KEY/);
    expect(
      testEnv({ PANEL_TOTP_ENFORCED: 'true', PANEL_TOTP_KEY: 'ab'.repeat(32) }).PANEL_TOTP_ENFORCED,
    ).toBe(true);
  });
});
