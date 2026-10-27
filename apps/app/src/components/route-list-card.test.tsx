/// <reference types="jest" />
import type { CatalogRouteCard } from '@pokatim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { RouteListCard, RouteListCardSkeleton } from './route-list-card';

const route = (overrides: Partial<CatalogRouteCard> = {}): CatalogRouteCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

describe('RouteListCard (routes-01)', () => {
  it('название, км · набор · петля, город · покрытие; одна ссылка для скринридера', async () => {
    const onPress = jest.fn();
    await render(<RouteListCard route={route()} onPress={onPress} />);
    expect(screen.getByText('Минское кольцо')).toBeOnTheScreen();
    expect(screen.getByText('86 км · набор 412 м · петля')).toBeOnTheScreen();
    expect(screen.getByText('Минск · асфальт, гравий')).toBeOnTheScreen();
    const link = screen.getByRole('link', {
      name: 'Минское кольцо. 86 км · набор 412 м · петля · Минск · асфальт, гравий',
    });
    await fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('незнакомые город и покрытие — строки места нет', async () => {
    await render(
      <RouteListCard
        route={route({
          city: 'unknown',
          surfaces: ['unknown'],
          elevationGainM: null,
          isLoop: false,
        })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Минское кольцо. 86 км' })).toBeOnTheScreen();
  });

  it('скелетон — для скринридера «Загрузка» не дублируется ссылкой', async () => {
    await render(<RouteListCardSkeleton />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
