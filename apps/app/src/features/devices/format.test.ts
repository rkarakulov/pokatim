/// <reference types="jest" />
import { garmin, TICKET, upload } from '@/__tests__/devices-fixtures';

import {
  deviceStatusLabel,
  formatKm,
  formatMinskDateTime,
  uploadStatus,
  uploadTitle,
} from './format';
import { parseDeviceReturn, returnUrlQuery } from './return-params';

/** 25 октября 2026, 15:00 по Минску; тесты идут в TZ Europe/Minsk, но подписи от пояса устройства не зависят. */
const NOW = new Date('2026-10-25T12:00:00Z');

describe('подписи «Устройств»', () => {
  it('дата и время — по Минску; год — только не текущий по Минску', () => {
    expect(formatMinskDateTime('2026-10-20T21:30:00Z', NOW)).toBe('21 октября, 00:30');
    expect(formatMinskDateTime('2025-12-31T21:30:00Z', NOW)).toBe('1 января, 00:30');
    expect(formatMinskDateTime('2025-12-31T20:00:00Z', NOW)).toBe('31 декабря 2025, 23:00');
  });

  it('км — одна цифра после запятой', () => {
    expect(formatKm(42_150)).toBe('42,2 км');
    expect(formatKm(100_000)).toBe('100 км');
  });

  it('статус подключения: `reauthorize` важнее статуса; незнакомый — «Не подключено»', () => {
    expect(deviceStatusLabel(garmin({ status: 'active', issue: 'reauthorize' }))).toBe(
      'Нужно подключить снова',
    );
    expect(deviceStatusLabel(garmin({ status: 'unknown' }))).toBe('Не подключено');
  });

  it.each([
    ['queued', null, 'Обрабатываем…'],
    ['processing', null, 'Обрабатываем…'],
    ['ready', null, 'Готово'],
    ['duplicate', null, 'Такой заезд уже есть'],
    ['failed', 'unreadable', 'Не удалось прочитать файл'],
    ['failed', 'no_track', 'В файле нет трека'],
    ['skipped', 'no_track', 'В файле нет трека'],
    ['failed', 'no_timestamps', 'В файле нет времени'],
    ['failed', 'implausible', 'Не удалось обработать'],
    ['failed', 'unknown', 'Не удалось обработать'],
    ['unknown', null, 'Обрабатываем…'],
  ] as const)('загрузка %s / %s — «%s»', (status, failure, label) => {
    expect(uploadStatus({ status, failure }).label).toBe(label);
  });

  it('заголовок загрузки: имя файла, иначе источник', () => {
    expect(uploadTitle(upload())).toBe('ride.gpx');
    expect(uploadTitle(upload({ fileName: null, source: 'wahoo' }))).toBe('Wahoo');
  });
});

describe('ссылка возврата из авторизации', () => {
  it('`pending` с тикетом формата контракта', () => {
    expect(
      parseDeviceReturn(
        returnUrlQuery(`pokatim://devices/return?provider=garmin&result=pending&t=${TICKET}`),
      ),
    ).toEqual({ kind: 'pending', provider: 'garmin', ticket: TICKET });
  });

  it.each([
    ['result=error', 'provider=garmin&result=error'],
    ['мусорный тикет', 'provider=garmin&result=pending&t=abc'],
    ['повтор параметра', `provider=garmin&result=pending&t=${TICKET}&t=${TICKET}`],
    ['неизвестный провайдер', `provider=strava&result=pending&t=${TICKET}`],
    ['битая %-последовательность', `provider=garmin&result=pending&t=%E0%A4%A`],
  ])('%s — ошибка без запроса', (_case, query) => {
    expect(parseDeviceReturn(returnUrlQuery(`pokatim://devices/return?${query}`))).toEqual({
      kind: 'error',
    });
  });
});
