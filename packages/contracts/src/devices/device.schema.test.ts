import { describe, expect, it } from 'vitest';

import {
  CompleteDeviceRequest,
  ConnectDeviceRequest,
  ConnectDeviceResponse,
  DEVICE_ISSUES,
  DEVICE_PROVIDERS,
  DEVICE_RETURN_RESULTS,
  DEVICE_STATUSES,
  DeviceList,
  DeviceProvider,
  DeviceReturnParams,
  DisconnectDeviceRequest,
} from './device.schema.ts';

const ticket = 'A'.repeat(42) + '_';
const view = {
  provider: 'garmin',
  name: 'Garmin',
  available: true,
  status: 'active',
  issue: null,
  connectedAt: '2026-10-26T08:00:00.000Z',
  lastSyncedAt: null,
};

describe('справочники устройств (только в конец)', () => {
  it('состав и порядок', () => {
    expect(DEVICE_PROVIDERS).toEqual(['garmin', 'wahoo']);
    expect(DEVICE_STATUSES).toEqual([
      'not_connected',
      'pending',
      'active',
      'disconnecting',
      'revoked',
    ]);
    expect(DEVICE_ISSUES).toEqual(['reauthorize', 'sync_failed', 'revoke_failed']);
    expect(DEVICE_RETURN_RESULTS).toEqual(['pending', 'error']);
  });

  it('провайдер в пути — строго', () => {
    expect(DeviceProvider.parse('wahoo')).toBe('wahoo');
    expect(DeviceProvider.safeParse('strava').success).toBe(false);
  });
});

describe('DeviceList (ответ приложения — tolerantEnum)', () => {
  it('разбор и незнакомые значения → unknown; служебные поля отбрасываются', () => {
    expect(DeviceList.parse({ items: [view] })).toEqual({ items: [view] });
    const parsed = DeviceList.parse({
      items: [
        { ...view, provider: 'polar', status: 'paused', issue: 'quota', aggUserId: 'secret' },
      ],
    });
    expect(parsed.items[0]).toMatchObject({
      provider: 'unknown',
      status: 'unknown',
      issue: 'unknown',
    });
    expect(parsed.items[0]).not.toHaveProperty('aggUserId');
  });
});

describe('запросы устройств — строгие', () => {
  it('connect: returnUrl обязателен, ≤ 300, без лишних ключей', () => {
    expect(ConnectDeviceRequest.parse({ returnUrl: 'pokatim://devices/return' })).toEqual({
      returnUrl: 'pokatim://devices/return',
    });
    expect(ConnectDeviceRequest.safeParse({}).success).toBe(false);
    expect(ConnectDeviceRequest.safeParse({ returnUrl: 'x'.repeat(301) }).success).toBe(false);
    expect(ConnectDeviceRequest.safeParse({ returnUrl: { $ne: '' } }).success).toBe(false);
    expect(ConnectDeviceRequest.safeParse({ returnUrl: 'a', userId: 'x' }).success).toBe(false);
  });

  it('ответ connect — только https', () => {
    expect(ConnectDeviceResponse.safeParse({ authorizeUrl: 'https://ow.test/a' }).success).toBe(
      true,
    );
    expect(ConnectDeviceResponse.safeParse({ authorizeUrl: 'http://ow.test/a' }).success).toBe(
      false,
    );
    expect(ConnectDeviceResponse.safeParse({ authorizeUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  it('complete: тикет — 43 символа base64url', () => {
    expect(CompleteDeviceRequest.parse({ ticket })).toEqual({ ticket });
    expect(CompleteDeviceRequest.safeParse({ ticket: ticket.slice(1) }).success).toBe(false);
    expect(CompleteDeviceRequest.safeParse({ ticket: `${ticket.slice(1)}=` }).success).toBe(false);
    expect(CompleteDeviceRequest.safeParse({ ticket: { $gt: '' } }).success).toBe(false);
  });

  it('disconnect: deleteActivities по умолчанию false', () => {
    expect(DisconnectDeviceRequest.parse({})).toEqual({ deleteActivities: false });
    expect(DisconnectDeviceRequest.parse({ deleteActivities: true })).toEqual({
      deleteActivities: true,
    });
    expect(DisconnectDeviceRequest.safeParse({ deleteActivities: 'yes' }).success).toBe(false);
  });

  it('параметры возврата: провайдер, результат, тикет', () => {
    expect(DeviceReturnParams.parse({ provider: 'garmin', result: 'pending', t: ticket })).toEqual({
      provider: 'garmin',
      result: 'pending',
      t: ticket,
    });
    expect(DeviceReturnParams.parse({ provider: 'wahoo', result: 'error' }).t).toBeUndefined();
    expect(DeviceReturnParams.safeParse({ provider: 'garmin', result: 'ok' }).success).toBe(false);
    expect(
      DeviceReturnParams.safeParse({ provider: 'garmin', result: 'pending', t: 'short' }).success,
    ).toBe(false);
  });
});
