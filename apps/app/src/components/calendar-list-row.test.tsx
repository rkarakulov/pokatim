/// <reference types="jest" />
import type { CalendarStartCard } from '@pokatim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CalendarListRow } from './calendar-list-row';

const start = (overrides: Partial<CalendarStartCard> = {}): CalendarStartCard => ({
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [80, 120],
  registrationUrl: null,
  phase: 'upcoming',
  ...overrides,
});

const NOW = new Date('2027-05-01T12:00:00Z');

describe('CalendarListRow', () => {
  it('рамка даты, название, мета; одна ссылка для скринридера', async () => {
    const onPress = jest.fn();
    await render(<CalendarListRow start={start()} now={NOW} onPress={onPress} />);

    expect(screen.getByText('14')).toBeOnTheScreen();
    expect(screen.getByText('июня')).toBeOnTheScreen();
    expect(screen.getByText('Минская сотка')).toBeOnTheScreen();
    expect(screen.getByText('80 и 120 км · Шоссе · Минск')).toBeOnTheScreen();
    const link = screen.getByRole('link', {
      name: 'Минская сотка. 14 июня. 80 и 120 км · Шоссе · Минск',
    });
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('многодневный — диапазон «26–27»; не текущий год — с годом', async () => {
    await render(
      <CalendarListRow
        start={start({ startsOn: '2028-06-26', endsOn: '2028-06-27' })}
        now={NOW}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('26–27')).toBeOnTheScreen();
    expect(screen.getByText('июня 2028')).toBeOnTheScreen();
  });

  it('многодневный через месяц: в рамке — начало, полный диапазон — в мете и метке (ревью pass 1)', async () => {
    await render(
      <CalendarListRow
        start={start({ startsOn: '2027-06-30', endsOn: '2027-07-01' })}
        now={NOW}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('30')).toBeOnTheScreen();
    expect(screen.getByText('июня')).toBeOnTheScreen();
    expect(screen.queryByText('30 июня–1 июля')).toBeNull();
    expect(screen.getByText('30 июня–1 июля · 80 и 120 км · Шоссе · Минск')).toBeOnTheScreen();
    expect(
      screen.getByRole('link', {
        name: 'Минская сотка. 30 июня–1 июля. 80 и 120 км · Шоссе · Минск',
      }),
    ).toBeOnTheScreen();
  });

  it('многодневный через год: в рамке — начало с годом, полный диапазон с годами — в мете и метке', async () => {
    await render(
      <CalendarListRow
        start={start({ startsOn: '2027-12-31', endsOn: '2028-01-01' })}
        now={NOW}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('31')).toBeOnTheScreen();
    expect(screen.getByText('декабря')).toBeOnTheScreen();
    const range = '31 декабря 2027–1 января 2028';
    expect(screen.getByText(`${range} · 80 и 120 км · Шоссе · Минск`)).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: `Минская сотка. ${range}. 80 и 120 км · Шоссе · Минск` }),
    ).toBeOnTheScreen();
  });

  it("'unknown' дисциплина — без подписи, не падает", async () => {
    await render(
      <CalendarListRow start={start({ discipline: 'unknown' })} now={NOW} onPress={jest.fn()} />,
    );
    expect(screen.getByText('80 и 120 км · Минск')).toBeOnTheScreen();
  });
});
