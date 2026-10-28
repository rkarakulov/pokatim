/// <reference types="jest" />
import type { CatalogRouteElevation } from '@pokatim/contracts';
import { appThemes, appThemeScheme, contrastRatio, themes, WCAG } from '@pokatim/design-tokens';
import {
  createScrubStore,
  PROFILE_FILL_OPACITY,
  PROFILE_NATIVE_FILL_OPACITY,
  type ScrubStore,
} from '@pokatim/route-view';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type * as ReactNative from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { ElevationProfile } from './elevation-profile';
import { PROFILE_BARS, PROFILE_PAN_TEST_ID } from './profile-chart';

/** RNGH v3: передача конфига обработчика в натив (эффект `useGesture` по ссылке конфига) — счётчик для M1. */
const nativeProxy = () =>
  jest.requireActual<{ NativeProxy: { setGestureHandlerConfig: (...args: unknown[]) => void } }>(
    'react-native-gesture-handler/lib/module/v3/NativeProxy',
  ).NativeProxy;

const elevation: CatalogRouteElevation = {
  minM: 191,
  maxM: 267,
  // первая половина — 191 м, вторая — 267 м: крайние столбики — мин. и макс.
  profile: Array.from({ length: 300 }, (_, i) => [i * 227, i < 150 ? 191 : 267]),
};

describe('ElevationProfile (routes-03, P4, RC-7)', () => {
  it('routes-04d (RC-10): без заголовка; диапазон строкой над графиком, график — одно изображение с текстовой альтернативой, подписи км', async () => {
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.queryByText('Профиль высоты')).toBeNull();
    expect(screen.getByText('191–267 м')).toBeOnTheScreen();
    const chart = screen.getByRole('image');
    expect(chart).toHaveProp('accessibilityLabel', 'Профиль высоты: от 191 до 267 м, набор 620 м');
    for (const label of ['0', '20', '40', '60 км']) {
      expect(screen.getByText(label, { includeHiddenElements: true })).toBeOnTheScreen();
    }
  });

  it('G2: площадь — react-native-svg (лениво): плавная линия map.corridor и заливка-градиент к прозрачному низу (G1)', async () => {
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    // svg скрыт от скринридера
    expect(
      await screen.findByTestId('elevation-profile-svg', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('elevation-profile-svg')).toBeNull();
    expect(
      screen.queryAllByTestId('elevation-profile-bar', { includeHiddenElements: true }),
    ).toHaveLength(0);
    const hidden = { includeHiddenElements: true };
    const gradient = screen.getByTestId('svg-LinearGradient', hidden);
    expect(gradient.props).toMatchObject({ x1: '0', y1: '0', x2: '0', y2: '1' });
    const stops = screen.getAllByTestId('svg-Stop', hidden).map((stop) => stop.props);
    expect(stops).toEqual([
      expect.objectContaining({
        offset: '0',
        stopColor: themes.light.map.corridor,
        stopOpacity: PROFILE_FILL_OPACITY,
      }),
      expect.objectContaining({
        offset: '1',
        stopColor: themes.light.map.corridor,
        stopOpacity: 0,
      }),
    ]);
    const [area, line] = screen.getAllByTestId('svg-Path', hidden).map((path) => path.props);
    expect(area.fill).toBe(`url(#${gradient.props.id})`);
    expect(line).toMatchObject({
      fill: 'none',
      stroke: themes.light.map.corridor,
      vectorEffect: 'non-scaling-stroke',
    });
    // линия — по каждой точке профиля: M + 299 × L
    expect(String(line.d).split('L')).toHaveLength(300);
  });

  it('G2: старый dev-клиент без react-native-svg — фолбэк: столбики светлым силуэтом, без кромки', async () => {
    const modules = jest.requireActual<typeof ReactNative>('react-native').TurboModuleRegistry;
    const get = modules.get.bind(modules);
    jest
      .spyOn(modules, 'get')
      .mockImplementation((name: string) => (name.startsWith('RNSVG') ? null : get(name)) as never);
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    expect(
      screen.queryByTestId('elevation-profile-svg', { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.queryAllByTestId('elevation-profile-bar')).toHaveLength(0);
    const bars = screen.getAllByTestId('elevation-profile-bar', { includeHiddenElements: true });
    expect(bars).toHaveLength(PROFILE_BARS);
    expect(bars[0]).toHaveStyle({ height: '8%' });
    expect(bars.at(-1)).toHaveStyle({ height: '100%' });
    expect(bars[0]).toHaveStyle({ backgroundColor: themes.light.map.corridor });
    expect(bars[0]).not.toHaveStyle({ borderTopWidth: expect.anything() });
    expect(bars[0]!.parent).toHaveStyle({ opacity: PROFILE_NATIVE_FILL_OPACITY });
  });

  it('нет профиля — блока нет; без набора — альтернатива без набора', async () => {
    await render(<ElevationProfile elevation={null} distanceM={68_000} gainM={null} />);
    expect(screen.queryByTestId('elevation-profile')).toBeNull();
    await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={null} />);
    expect(screen.getByRole('image')).toHaveProp(
      'accessibilityLabel',
      'Профиль высоты: от 191 до 267 м',
    );
  });

  it('SSR-безопасно: без onLayout, повторный рендер идентичен; разметка зависит только от данных', async () => {
    const view = await render(
      <ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />,
    );
    await screen.findByTestId('elevation-profile-svg', { includeHiddenElements: true });
    const first = JSON.stringify(view.toJSON());
    expect(first).not.toContain('onLayout');
    await view.rerender(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />);
    expect(JSON.stringify(view.toJSON())).toBe(first);
  });

  it('линия профиля (map.corridor, приглушённая) контрастна фону карточки в обеих темах (WCAG для графики)', () => {
    for (const theme of [themes.light, themes.dark]) {
      expect(contrastRatio(theme.map.corridor, theme.surface.default)).toBeGreaterThanOrEqual(
        WCAG.ui,
      );
    }
  });
});

describe('ElevationProfile: скраббинг native (routes-04, S1, S4)', () => {
  const renderScrub = (store: ScrubStore) =>
    render(
      <GestureHandlerRootView>
        <ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} scrub={store} />
      </GestureHandlerRootView>,
    );
  const chart = () => screen.getByTestId('elevation-profile-chart');
  /** ширина графика после раскладки — 340 pt */
  const layout = () =>
    fireEvent(chart(), 'layout', {
      nativeEvent: { layout: { width: 340, height: 85, x: 0, y: 0 } },
    });

  it('adjustable: подпись — сводка P4, значение — «0 км, высота 191 м, уклон 0 %»; курсора и карточки нет', async () => {
    await renderScrub(createScrubStore());
    const adjustable = screen.getByRole('adjustable', {
      name: 'Профиль высоты: от 191 до 267 м, набор 620 м',
    });
    expect(adjustable).toHaveProp('accessibilityValue', { text: '0 км, высота 191 м, уклон 0 %' });
    expect(adjustable.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'increment',
      'decrement',
    ]);
    expect(
      screen.queryByTestId('elevation-profile-cursor', { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByText('191–267 м')).toBeOnTheScreen();
  });

  it('increment/decrement — ±1 км: стор, значение, курсор и карточка вместо диапазона', async () => {
    const store = createScrubStore();
    await renderScrub(store);
    await fireEvent(chart(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(chart(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(store.getState()).toMatchObject({ fraction: 2000 / 68_000, active: true });
    expect(chart()).toHaveProp('accessibilityValue', { text: '2 км, высота 191 м, уклон 0 %' });
    expect(screen.queryByText('191–267 м')).toBeNull();
    expect(
      screen.getByText('2 км · 191 м · → 0 % · набор 0 м', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    // карточка скрыта от скринридера — значение озвучивает график
    expect(screen.queryByText(/^2 км ·/)).toBeNull();
    await fireEvent(chart(), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(store.getState().fraction).toBeCloseTo(1000 / 68_000, 9);
  });

  it('long-press + перетаскивание: dragging «profile» на время жеста, доля — X / ширина; тап (без удержания) — курсор скрыт', async () => {
    const store = createScrubStore();
    await renderScrub(store);
    await layout();
    const seen: { dragging: string | null; fraction: number }[] = [];
    store.subscribe(({ dragging, fraction }) => seen.push({ dragging, fraction }));
    // fireGestureHandler дополняет переходы до END: жест целиком
    await act(async () =>
      fireGestureHandler(getByGestureTestId(PROFILE_PAN_TEST_ID), [
        { state: State.BEGAN, x: 85 },
        { state: State.ACTIVE, x: 85 },
        { x: 170 },
        { state: State.END, x: 170 },
      ]),
    );
    // во время жеста — dragging «profile» (экран выключает прокрутку), доля 0,25 → 0,5; после — null
    expect(seen).toContainEqual({ dragging: 'profile', fraction: 0.25 });
    expect(seen).toContainEqual({ dragging: 'profile', fraction: 0.5 });
    expect(store.getState()).toMatchObject({ fraction: 0.5, active: true, dragging: null });
    const cursor = screen.getByTestId('elevation-profile-cursor', { includeHiddenElements: true });
    expect(cursor).toHaveStyle({ left: '50%' });
    // тап: касание отпущено до удержания — жест не активировался (fireGestureHandler вставил бы ACTIVE)
    const tap = createGestureController(PROFILE_PAN_TEST_ID);
    await act(async () => tap.begin({ x: 30 }));
    await act(async () => tap.fail({ x: 30 }));
    expect(store.getState().active).toBe(false);
    expect(
      screen.queryByTestId('elevation-profile-cursor', { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByText('191–267 м')).toBeOnTheScreen();
  });

  it('до раскладки жест не двигает курсор (ширина неизвестна)', async () => {
    const store = createScrubStore();
    await renderScrub(store);
    await act(async () =>
      fireGestureHandler(getByGestureTestId(PROFILE_PAN_TEST_ID), [
        { state: State.BEGAN, x: 85 },
        { state: State.ACTIVE, x: 85 },
        { state: State.END, x: 85 },
      ]),
    );
    expect(store.getState()).toMatchObject({ fraction: 0, active: false, dragging: null });
  });

  it('M1: движение курсора не пересоздаёт конфиг жеста — обработчик не перенастраивается в натив на кадр', async () => {
    const setConfig = jest.spyOn(nativeProxy(), 'setGestureHandlerConfig');
    const store = createScrubStore();
    await renderScrub(store);
    await screen.findByTestId('elevation-profile-svg', { includeHiddenElements: true });
    const before = setConfig.mock.calls.length;
    // шпион на том же экземпляре RNGH, что и компонент (иначе тест — тавтология)
    expect(before).toBeGreaterThan(0);
    for (const fraction of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      await act(async () => store.setState({ fraction, active: true }));
    }
    expect(chart()).toHaveProp('accessibilityValue', { text: expect.stringMatching(/^34 км,/) });
    expect(setConfig.mock.calls.length).toBe(before);
    setConfig.mockRestore();
  });
});

describe('ElevationProfile native — заливка во всех темах — градиент', () => {
  const hidden = { includeHiddenElements: true };

  it.each(Object.values(appThemes))(
    '$id — градиент profile.fillTop → fillBottom темы, площадь и линия',
    async (def) => {
      await render(<ElevationProfile elevation={elevation} distanceM={68_000} gainM={620} />, {
        wrapper: appThemeWrapper(def.id),
      });
      await screen.findByTestId('elevation-profile-svg', hidden);
      const { profile } =
        appThemeScheme(def, 'light') === 'dark' ? def.schemes.dark : def.schemes.light;
      const stops = screen.getAllByTestId('svg-Stop', hidden).map((stop) => stop.props);
      expect(stops.map((stop) => [stop.stopColor, stop.stopOpacity])).toEqual([
        [profile.fillTop, PROFILE_FILL_OPACITY],
        [profile.fillBottom, 0],
      ]);
      expect(screen.getAllByTestId('svg-Path', hidden)).toHaveLength(2);
    },
  );
});
