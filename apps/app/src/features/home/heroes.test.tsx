/// <reference types="jest" />
import type { RaceCard } from '@pokatim/contracts';
import { render, screen } from '@testing-library/react-native';

import { RaceHero } from './heroes';

const race: RaceCard = {
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: { id: '0190a6f4-0000-7000-8000-000000000009', name: 'Сезон 2026' },
};

describe('RaceHero без «сейчас» (guest-landing, RC-8: SSR и гидрация)', () => {
  it('`now={null}` — окно гонки с годом', async () => {
    await render(<RaceHero race={race} now={null} onPress={() => undefined} />);
    expect(
      screen.getByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября 2026'),
    ).toBeOnTheScreen();
  });
});
