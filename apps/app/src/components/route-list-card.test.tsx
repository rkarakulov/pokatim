/// <reference types="jest" />
import type { CatalogRouteCard, MyRoute } from '@pokatim/contracts';
import { appThemes, space } from '@pokatim/design-tokens';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { MyRouteListCard, RouteListCard, RouteListCardSkeleton } from './route-list-card';

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

const mine = (overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Вечерний круг',
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  createdAt: '2026-10-26T21:30:00.000Z',
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

describe('MyRouteListCard (routes-02)', () => {
  it('готовый: цифры и дата загрузки по Минску; одна ссылка', async () => {
    const onPress = jest.fn();
    await render(<MyRouteListCard route={mine()} onPress={onPress} />);
    expect(screen.getByText('42 км · набор 310 м · петля')).toBeOnTheScreen();
    expect(screen.getByText('27 октября 2026')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('link', {
        name: 'Вечерний круг. 42 км · набор 310 м · петля · 27 октября 2026',
      }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('обрабатывается — статус вместо цифр', async () => {
    await render(
      <MyRouteListCard
        route={mine({ status: 'processing', distanceM: null, elevationGainM: null, isLoop: null })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Обрабатывается')).toBeOnTheScreen();
    expect(screen.queryByText(/км/)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Вечерний круг. Обрабатывается · 27 октября 2026' }),
    ).toBeOnTheScreen();
  });

  it('отказ — причина', async () => {
    await render(
      <MyRouteListCard
        route={mine({ status: 'failed', failure: 'too_short', distanceM: null })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Маршрут короче 1 км')).toBeOnTheScreen();
  });
});

describe('RouteListCard: плотность темы (app-themes C1)', () => {
  it('«Классика» (regular) — прежний отступ s4; Планировщик (comfortable) — s5', async () => {
    const { unmount } = await render(<RouteListCard route={route()} onPress={jest.fn()} />);
    expect(screen.getByRole('link')).toHaveStyle({ paddingVertical: space.s4 });
    await unmount();
    await render(<RouteListCard route={route()} onPress={jest.fn()} />, {
      wrapper: appThemeWrapper('planner'),
    });
    expect(screen.getByRole('link')).toHaveStyle({ paddingVertical: space.s5 });
  });
});

describe('карточка списка: варианты по теме (app-themes C2)', () => {
  const hidden = { includeHiddenElements: true };

  it('classic — hairline сверху, без шеврона', async () => {
    await render(<RouteListCard route={route()} onPress={jest.fn()} />);
    expect(screen.getByRole('link')).toHaveStyle({ borderTopWidth: expect.any(Number) });
    expect(screen.queryByTestId('route-card-chevron', hidden)).toBeNull();
  });

  it('tile (Атлас) — карточка surface.raised с радиусом shape.card, отступ и зазор плотности, шеврон', async () => {
    await render(<RouteListCard route={route()} onPress={jest.fn()} />, {
      wrapper: appThemeWrapper('atlas'),
    });
    const { surface, shape } = appThemes.atlas.schemes.light;
    expect(screen.getByRole('link')).toHaveStyle({
      backgroundColor: surface.raised,
      borderRadius: shape.card,
      padding: space.s5,
      marginBottom: space.s3,
    });
    expect(screen.getByTestId('route-card-chevron', hidden)).toBeOnTheScreen();
    expect(screen.getByText('86 км · набор 412 м · петля')).toBeOnTheScreen();
  });

  it('tile (Хронометр, плотность regular) — плитки не вплотную: зазор s2', async () => {
    await render(<RouteListCard route={route()} onPress={jest.fn()} />, {
      wrapper: appThemeWrapper('chrono'),
    });
    expect(screen.getByRole('link')).toHaveStyle({ padding: space.s4, marginBottom: space.s2 });
  });

  it('numeral (Типографика) — дистанция крупно, название, мета и шеврон; ссылка та же', async () => {
    await render(<RouteListCard route={route()} onPress={jest.fn()} />, {
      wrapper: appThemeWrapper('typography'),
    });
    const link = screen.getByRole('link', {
      name: 'Минское кольцо. 86 км · набор 412 м · петля · Минск · асфальт, гравий',
    });
    expect(within(link).getByTestId('route-card-numeral', hidden)).toHaveTextContent('86км');
    expect(within(link).getByText('Минское кольцо')).toBeOnTheScreen();
  });

  it('numeral без дистанции (свой маршрут в обработке) — тело как у tile', async () => {
    await render(
      <MyRouteListCard
        route={mine({ status: 'processing', distanceM: null, elevationGainM: null, isLoop: null })}
        onPress={jest.fn()}
      />,
      { wrapper: appThemeWrapper('typography') },
    );
    expect(screen.queryByTestId('route-card-numeral', hidden)).toBeNull();
    expect(screen.getByTestId('route-card-chevron', hidden)).toBeOnTheScreen();
    expect(screen.getByText('Обрабатывается')).toBeOnTheScreen();
  });

  it('numeral: свой готовый маршрут — дистанция крупно', async () => {
    await render(<MyRouteListCard route={mine()} onPress={jest.fn()} />, {
      wrapper: appThemeWrapper('typography'),
    });
    expect(screen.getByTestId('route-card-numeral', hidden)).toHaveTextContent('42км');
  });

  it.each([
    ['classic', 'route-card-skeleton-classic'],
    ['atlas', 'route-card-skeleton-tile'],
    ['typography', 'route-card-skeleton-numeral'],
  ] as const)('скелетон повторяет вариант: %s', async (themeId, testID) => {
    await render(<RouteListCardSkeleton />, { wrapper: appThemeWrapper(themeId) });
    expect(screen.getByTestId(testID, hidden)).toBeOnTheScreen();
  });
});
