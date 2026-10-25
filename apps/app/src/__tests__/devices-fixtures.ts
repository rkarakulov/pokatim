import type { DeviceList, DeviceView, TrackUpload, TrackUploadPage } from '@pokatim/contracts';

/** Фикстуры «Устройств»: провайдеры и загрузки в форме ответов API (контракты tracks-devices). */
export const TICKET = 'T'.repeat(43);

export const garmin = (overrides: Partial<DeviceView> = {}): DeviceView => ({
  provider: 'garmin',
  name: 'Garmin',
  available: true,
  status: 'not_connected',
  issue: null,
  connectedAt: null,
  lastSyncedAt: null,
  ...overrides,
});

export const wahoo = (overrides: Partial<DeviceView> = {}): DeviceView => ({
  ...garmin(),
  provider: 'wahoo',
  name: 'Wahoo',
  ...overrides,
});

export const deviceList = (...items: DeviceView[]): DeviceList => ({ items });

export const UPLOAD_ID = '0199c000-0000-7000-8000-000000000001';

export const upload = (overrides: Partial<TrackUpload> = {}): TrackUpload => ({
  id: UPLOAD_ID,
  source: 'upload',
  format: 'gpx',
  fileName: 'ride.gpx',
  status: 'ready',
  failure: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  activity: {
    id: '0199c000-0000-7000-8000-0000000000a1',
    sport: 'cycling',
    // 09:30 по Минску
    startedAt: '2026-10-20T06:30:00.000Z',
    elapsedSec: 7200,
    distanceM: 42_150,
  },
  ...overrides,
});

export const uploadPage = (...items: TrackUpload[]): TrackUploadPage => ({
  items,
  nextCursor: null,
});
