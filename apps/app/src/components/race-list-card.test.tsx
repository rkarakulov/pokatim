/// <reference types="jest" />
import type { RaceCard } from '@pokatim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { RaceListCard } from './race-list-card';

const race = (overrides: Partial<RaceCard> = {}): RaceCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel', 'asphalt'],
  distanceKm: 62,
  // 4 октября 00:00 — 12 октября 23:59 по Минску
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  ...overrides,
});

const NOW = new Date('2026-10-01T12:00:00Z');

describe('RaceListCard', () => {
  it('даты и км, название, класс и покрытия, строка окна; одна ссылка для скринридера', async () => {
    const onPress = jest.fn();
    await render(<RaceListCard race={race()} now={NOW} onPress={onPress} />);

    expect(screen.getByText('4–12')).toBeOnTheScreen();
    expect(screen.getByText('октября')).toBeOnTheScreen();
    expect(screen.getByText('62 км')).toBeOnTheScreen();
    expect(screen.getByText('Класс «Гравий» · покрытие: гравий · асфальт')).toBeOnTheScreen();
    const link = screen.getByRole('link', {
      name: 'Гравийный коридор Логойск. 4–12 октября. Окно откроется 4 октября, 00:00',
    });
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
    // плашек участия и результатов нет (§4)
    expect(screen.queryByText(/Verified|Предварительный|Финальный/)).toBeNull();
  });

  it('отменённая — баннер с причиной вместо строки окна; метка — с причиной', async () => {
    await render(
      <RaceListCard
        race={race({ phase: 'cancelled', cancelReason: 'weather' })}
        now={NOW}
        onPress={jest.fn()}
      />,
    );

    const message = 'Гонка отменена. Причина: Неблагоприятные погодные условия.';
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.queryByText(/Окно откроется/)).toBeNull();
    expect(
      screen.getByLabelText(`Гравийный коридор Логойск. 4–12 октября. ${message}`),
    ).toBeOnTheScreen();
  });

  it("'unknown' в фазе, классе и покрытиях — без строки и подписей, не падает (R9)", async () => {
    await render(
      <RaceListCard
        race={race({ phase: 'unknown', bikeClass: 'unknown', surfaces: ['unknown'] })}
        now={NOW}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Гравийный коридор Логойск. 4–12 октября')).toBeOnTheScreen();
    expect(screen.queryByText(/Класс|Покрытие|Окно/)).toBeNull();
  });

  it('публичный экран: даты с годом, now = null — без «сегодня / завтра»', async () => {
    await render(
      <RaceListCard race={race({ phase: 'open' })} now={null} datesWithYear onPress={jest.fn()} />,
    );

    expect(screen.getByText('октября 2026')).toBeOnTheScreen();
    expect(screen.getByText('Окно открыто до 12 октября 2026, 23:59.')).toBeOnTheScreen();
  });
});
