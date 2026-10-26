// @vitest-environment jsdom
import type { PanelDispute, PanelDisputeSeriesData } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { ME, renderApp } from '../../test/app';
import { SERIES_POLL_MAX_MS, SERIES_POLL_MS } from './DisputeSeries';
import { binAt, seriesPath, seriesRange } from './SeriesChart';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    getDispute: vi.fn(),
    getDisputeSeries: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a9001';
const TARGET = '01890a5d-ac96-774b-bcce-b302099a0a01';
const RIDER = '01890a5d-ac96-774b-bcce-b302099a0d04';

const DISPUTE: PanelDispute = {
  id: ID,
  race: { id: '01890a5d-ac96-774b-bcce-b302099a8080', title: 'Осенний коридор' },
  status: 'open',
  category: 'speed_vs_heart_rate',
  targetEntryId: TARGET,
  complainantEntryId: '01890a5d-ac96-774b-bcce-b302099a0b02',
  filedAt: '2026-10-26T07:00:00.000Z',
  decidableAt: '2026-10-26T19:00:00.000Z',
  responded: false,
  description: null,
  response: null,
  target: {
    entryId: TARGET,
    userId: RIDER,
    resultStatus: 'provisional',
    place: 1,
    tied: false,
    elapsedSec: 900,
  },
  complainant: { entryId: '01890a5d-ac96-774b-bcce-b302099a0b02', userId: RIDER },
  decision: null,
  events: [{ kind: 'filed', actorKind: 'rider', at: '2026-10-26T07:00:00.000Z' }],
  filingClosesAt: '2026-10-26T20:59:00.000Z',
  protocolPlannedAt: '2026-10-27T20:59:00.000Z',
  canDecide: false,
  decideBlockedBy: 'too_early',
};

const SERIES: PanelDisputeSeriesData = {
  segmentDistanceM: 3000,
  distanceM: [1000, 2000, 3000],
  heartRate: [150, null, 170],
  power: null,
  speedKmh: [36.5, 40, 42.4],
  summary: {
    avgHeartRate: 160,
    maxHeartRate: 172,
    avgPower: null,
    maxPower: null,
    avgSpeedKmh: 39.6,
  },
};

const show = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Показать пульс и мощность' }));

beforeEach(async () => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.getDispute.mockResolvedValue(DISPUTE);
  await renderApp(`/disputes/${ID}`);
  await screen.findByRole('heading', { name: 'Пульс и мощность' });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Пульс и мощность» на разборе спора (06b, AC10)', () => {
  it('ряды запрашиваются только по кнопке; «готовится» → опрос → графики со сводкой', async () => {
    expect(mocked.getDisputeSeries).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Биометрия заезда — только для разбора спора: видит команда платформы, в системе не сохраняется.',
      ),
    ).toBeTruthy();
    mocked.getDisputeSeries
      .mockResolvedValueOnce({ state: 'preparing' })
      .mockResolvedValue({ state: 'ready', series: SERIES });
    show();
    expect(await screen.findByText('Ряды готовятся…')).toBeTruthy();
    expect(mocked.getDisputeSeries).toHaveBeenCalledWith(ID);

    const heart = await screen.findByRole(
      'img',
      { name: 'Пульс по дистанции: среднее 160, максимум 172 уд/мин' },
      { timeout: 5000 },
    );
    expect(heart).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Скорость по дистанции: средняя 39,6 км/ч' }),
    ).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Мощность/ })).toBeNull();
    expect(screen.getByText('Нет данных мощности в этом заезде')).toBeTruthy();
    expect(screen.getByText(/Сегмент старт → финиш: 3,0 км/)).toBeTruthy();
    expect(mocked.getDisputeSeries).toHaveBeenCalledTimes(2);

    // шкала Y — минимум и максимум ряда
    expect(screen.getByText('шкала 150–170 уд/мин')).toBeTruthy();
    expect(screen.getByText('шкала 36,5–42,4 км/ч')).toBeTruthy();

    // курсор: значение под перекрестием во всех графиках
    heart.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    fireEvent.pointerMove(heart, { clientX: 300 });
    expect(screen.getByText('3,0 км: 170 уд/мин')).toBeTruthy();
    expect(screen.getByText('3,0 км: 42,4 км/ч')).toBeTruthy();
    fireEvent.pointerMove(heart, { clientX: 150 });
    expect(screen.getByText('2,0 км: —')).toBeTruthy();
    fireEvent.pointerLeave(heart);
    expect(screen.queryByText('2,0 км: —')).toBeNull();

    // таблица значений — текстовая альтернатива
    expect(screen.getByRole('columnheader', { name: 'Дистанция' })).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(SERIES.distanceM.length + 1);
  }, 10_000);

  it('рядов нет — причина; отказ разбора — «Повторить» запрашивает снова', async () => {
    mocked.getDisputeSeries
      .mockResolvedValueOnce({ state: 'unavailable', reason: 'failed' })
      .mockResolvedValue({ state: 'unavailable', reason: 'no_source' });
    show();
    expect(
      await screen.findByText(
        'Не удалось построить ряды из файла заезда. Повторить можно через 2 минуты.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Исходный файл заезда недоступен — рядов нет.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('«готовится» дольше 3 мин — опрос остановлен, «Повторить» запрашивает снова', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocked.getDisputeSeries.mockResolvedValue({ state: 'preparing' });
      show();
      expect(await screen.findByText('Ряды готовятся…')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(SERIES_POLL_MAX_MS + SERIES_POLL_MS);
      expect(
        await screen.findByText('Ряды не подготовлены вовремя — попробуйте ещё раз.'),
      ).toBeTruthy();
      const calls = mocked.getDisputeSeries.mock.calls.length;
      await vi.advanceTimersByTimeAsync(SERIES_POLL_MS * 3);
      expect(mocked.getDisputeSeries.mock.calls.length).toBe(calls);

      mocked.getDisputeSeries.mockResolvedValue({ state: 'ready', series: SERIES });
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(await screen.findByText(/Сегмент старт → финиш/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ошибка запроса — состояние ошибки с повтором', async () => {
    mocked.getDisputeSeries.mockRejectedValue(new Error('boom'));
    show();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 5000 });
  }, 10_000);
});

describe('геометрия графика', () => {
  it('seriesPath: разрыв на null, X — доля дистанции, ровный ряд — посередине', () => {
    expect(seriesPath([100, 200, 300, 400], [1, 2, null, 3])).toBe('M250,149L500,80M1000,11');
    expect(seriesPath([500, 1000], [150, 150])).toBe('M500,80L1000,80');
    expect(seriesPath([1000], [150])).toBeNull();
  });

  it('seriesRange: минимум и максимум без null; пусто — null', () => {
    expect(seriesRange([150, null, 170, 160])).toEqual({ min: 150, max: 170 });
    expect(seriesRange([null])).toBeNull();
  });

  it('binAt: ближайшая ячейка не левее точки, края — первая и последняя', () => {
    const ends = [250, 500, 750, 1000];
    expect(binAt(ends, 0)).toBe(0);
    expect(binAt(ends, 0.26)).toBe(1);
    expect(binAt(ends, 0.5)).toBe(1);
    expect(binAt(ends, 1.2)).toBe(3);
  });
});
