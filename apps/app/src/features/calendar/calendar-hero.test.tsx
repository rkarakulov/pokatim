/// <reference types="jest" />
import type { CalendarStartCard } from '@pokatim/contracts';
import { render, screen } from '@testing-library/react-native';

import { CalendarStartHero } from './calendar-hero';

const start = (overrides: Partial<CalendarStartCard> = {}): CalendarStartCard => ({
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100],
  registrationUrl: 'https://example.by/registration',
  phase: 'upcoming',
  ...overrides,
});

const NOW = new Date('2027-05-01T12:00:00Z');

describe('CalendarStartHero: строка регистрации (ревью pass 1)', () => {
  it('безопасная https-ссылка — «Регистрация у организатора.»', async () => {
    await render(<CalendarStartHero start={start()} now={NOW} />);
    expect(screen.getByText('Регистрация у организатора.')).toBeOnTheScreen();
  });

  it.each([
    null,
    'http://example.by/registration',
    'javascript:alert(1)',
    'https://u:p@example.by/',
  ])('ссылка %p — строки нет (то же условие, что у кнопки карточки)', async (registrationUrl) => {
    await render(<CalendarStartHero start={start({ registrationUrl })} now={NOW} />);
    expect(screen.queryByText('Регистрация у организатора.')).toBeNull();
  });
});

describe('CalendarStartHero без «сейчас» (guest-landing, RC-8: SSR и гидрация)', () => {
  it('`now={null}` — дата с годом, без строки «До старта N дней»', async () => {
    await render(<CalendarStartHero start={start()} now={null} />);
    expect(screen.getByLabelText('Ближайший старт. Минская сотка. 14 июня 2027')).toBeOnTheScreen();
    expect(screen.queryByText(/До старта/)).toBeNull();
  });

  it('с `now` — строка «До старта N дней» есть', async () => {
    await render(<CalendarStartHero start={start()} now={NOW} />);
    expect(screen.getByText(/До старта/)).toBeOnTheScreen();
  });
});
