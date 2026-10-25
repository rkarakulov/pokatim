import { describe, expect, it } from 'vitest';

import { testEnv } from '../../test/test-env';

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
});
