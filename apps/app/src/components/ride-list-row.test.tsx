/// <reference types="jest" />
import type { RideCard } from '@pokatim/contracts';
import { size } from '@pokatim/design-tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RideListRow } from './ride-list-row';

const NOW = new Date('2026-10-01T12:00:00Z');

const ride: RideCard = {
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Кофе-райд',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  viewer: { role: 'none', canJoin: true, canLeave: false, canManage: false },
};

describe('RideListRow', () => {
  it('время и город, название, мета, стопка; одна ссылка; действие — вне ссылки', async () => {
    const onPress = jest.fn();
    await render(
      <RideListRow ride={ride} now={NOW} onPress={onPress} action={<Text>действие</Text>} />,
    );
    const link = screen.getByRole('link', {
      name: 'Кофе-райд. 10:00 · Минск. 42 км · темп 22–24 км/ч · старт: Парк Победы. идут 5 из 12',
    });
    expect(screen.getByText('идут 5 из 12')).toBeOnTheScreen();
    expect(screen.getByText('действие')).toBeOnTheScreen();
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('ride-row')).toHaveStyle({ minHeight: size.rowMin });
  });
});
