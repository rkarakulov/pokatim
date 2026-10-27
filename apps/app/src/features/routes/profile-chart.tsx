import type { CatalogRouteElevation } from '@pokatim/contracts';
import { stroke, type AppTheme } from '@pokatim/design-tokens';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { useScrub, type ScrubStore } from '@/features/maps/scrub-store';

import { profileBarHeights, profileBars } from './format';
import { loadSvgNative } from './load-svg-native';
import type { ProfileChartProps } from './profile-chart-props';
import { PROFILE_VIEW_BOX, profileGradientId, profilePaths } from './profile-path';
import {
  PROFILE_ASPECT_RATIO,
  PROFILE_FILL_OPACITY,
  PROFILE_NATIVE_FILL_OPACITY,
} from './profile-style';
import { svgSupported } from './svg-support';
import { scrubReadout, scrubStep } from './scrub';

type SvgLib = Awaited<ReturnType<typeof loadSvgNative>>;

/** Столбиков фолбэка: ≈ 2 px при ширине телефона — ступенек не видно, Yoga округляет к пиксельной сетке. */
export const PROFILE_BARS = 160;

/** Удержание пальца до начала скраббинга, мс (S1): до него вертикальная прокрутка экрана не перехвачена. */
export const PROFILE_LONG_PRESS_MS = 250;

/** testID жеста графика — для `getByGestureTestId` в тестах. */
export const PROFILE_PAN_TEST_ID = 'elevation-profile-pan';

const ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const;

/**
 * Фолбэк площади без `react-native-svg` (старый dev-клиент, routes-04 G2): узкие столбики `View` в приглушённом цвете
 * `map.corridor` — светлый силуэт (`PROFILE_NATIVE_FILL_OPACITY`) без кромки, как routes-03.
 */
const ProfileBars = memo(function ProfileBars({
  elevation,
  theme,
}: {
  elevation: CatalogRouteElevation;
  theme: AppTheme;
}) {
  const heights = profileBarHeights(
    profileBars(elevation.profile, PROFILE_BARS),
    elevation.minM,
    elevation.maxM,
  );
  const color = theme.map.corridor;
  return (
    <View
      style={[styles.bars, { opacity: PROFILE_NATIVE_FILL_OPACITY }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {heights.map((height, index) => (
        <View
          // столбики статичны — ключ по позиции
          key={index}
          testID="elevation-profile-bar"
          style={[styles.bar, { height: `${height * 100}%`, backgroundColor: color }]}
        />
      ))}
    </View>
  );
});

/** `react-native-svg` после монтирования: `null` — грузится, `false` — модуля в сборке нет. */
function useSvgLib(): SvgLib | false | null {
  const [lib, setLib] = useState<SvgLib | false | null>(() => (svgSupported() ? null : false));
  useEffect(() => {
    if (lib !== null) return;
    let cancelled = false;
    loadSvgNative()
      .then((loaded) => {
        if (!cancelled) setLib(loaded);
      })
      .catch(() => {
        if (!cancelled) setLib(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lib]);
  return lib;
}

/**
 * Площадь профиля на native (routes-04 G1/G2): тот же SVG, что на web, — плавная линия `map.corridor` толщиной
 * `stroke.input` и заливка-градиент (у линии `PROFILE_FILL_OPACITY`, внизу прозрачно) через `react-native-svg`
 * (лениво: пакет требует нативный модуль при импорте). Модуля нет — столбики; пока грузится — пусто (без мигания
 * столбиков). Скрыта от скринридера, при движении курсора не перерисовывается (`memo`).
 */
const ProfileArea = memo(function ProfileArea({
  elevation,
  theme,
}: {
  elevation: CatalogRouteElevation;
  theme: AppTheme;
}) {
  const lib = useSvgLib();
  const gradient = profileGradientId(useId());
  if (lib === false) return <ProfileBars elevation={elevation} theme={theme} />;
  const paths = profilePaths(elevation);
  if (lib === null || !paths) return null;
  const color = theme.map.corridor;
  return (
    <View
      testID="elevation-profile-svg"
      style={styles.area}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <lib.Svg viewBox={PROFILE_VIEW_BOX} preserveAspectRatio="none" width="100%" height="100%">
        <lib.Defs>
          <lib.LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <lib.Stop offset="0" stopColor={color} stopOpacity={PROFILE_FILL_OPACITY} />
            <lib.Stop offset="1" stopColor={color} stopOpacity={0} />
          </lib.LinearGradient>
        </lib.Defs>
        <lib.Path d={paths.area} fill={`url(#${gradient})`} />
        <lib.Path
          d={paths.line}
          fill="none"
          stroke={color}
          strokeWidth={stroke.input}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </lib.Svg>
    </View>
  );
});

/**
 * График профиля на native: площадь `ProfileArea` (SVG или фолбэк-столбики). Без `scrub` — одно изображение с
 * текстовой альтернативой (routes-03, без `onLayout`). Со `scrub` (routes-04) — `adjustable`: increment/decrement — ±1 км, значение «12,4 км, высота 231 м,
 * уклон 4 %»; long-press (250 мс) + перетаскивание ведёт курсор (стор: `dragging: 'profile'` — экран выключает
 * прокрутку), касание без удержания (тап) — скрыть. Курсор — вертикальная линия `left: f × 100 %` без анимации (RC-12).
 */
export function ProfileChart(props: ProfileChartProps) {
  const { elevation, theme, label, scrub } = props;
  if (!scrub) {
    return (
      <View
        testID="elevation-profile-chart"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[styles.chart, { borderBottomColor: theme.border.subtle }]}
      >
        <ProfileArea elevation={elevation} theme={theme} />
      </View>
    );
  }
  return <ScrubbableChart {...props} scrub={scrub} />;
}

/**
 * Носитель жеста: на долю не подписан, конфиг `usePanGesture` стабилен (`useMemo` по стору) — на кадр скраббинга
 * обработчик не перерегистрируется в натив (ревью pass 1, M1). Подписчик доли — `ScrubbableBody`.
 */
function ScrubbableChart(props: ProfileChartProps & { scrub: ScrubStore }) {
  const { scrub } = props;
  // ширина — только для перевода X пальца в долю; до раскладки жест игнорируется
  const width = useRef(0);
  // жест в этом касании активировался (удержание); нет — касание было тапом или началом прокрутки: курсор скрыть
  const activated = useRef(false);
  // один жест вместо композиции «pan + tap»: касание без активации — тап (или начало прокрутки) — скрывает курсор
  // (RC-8); колбэки читают стор через getState — конфиг не зависит от доли
  const config = useMemo(() => {
    const follow = (x: number) => {
      if (width.current <= 0) return;
      scrub.setState({ fraction: Math.min(1, Math.max(0, x / width.current)), active: true });
    };
    return {
      testID: PROFILE_PAN_TEST_ID,
      runOnJS: true,
      activateAfterLongPress: PROFILE_LONG_PRESS_MS,
      onBegin: () => {
        activated.current = false;
      },
      onActivate: (event: { x: number }) => {
        activated.current = true;
        scrub.setState({ dragging: 'profile' });
        follow(event.x);
      },
      onUpdate: (event: { x: number }) => follow(event.x),
      onFinalize: () => {
        if (!activated.current) {
          if (scrub.getState().active) scrub.setState({ active: false });
        } else if (scrub.getState().dragging === 'profile') {
          scrub.setState({ dragging: null });
        }
      },
    };
  }, [scrub]);
  const pan = usePanGesture(config);
  const onWidth = useCallback((next: number) => {
    width.current = next;
  }, []);
  return (
    <GestureDetector gesture={pan}>
      <ScrubbableBody {...props} onWidth={onWidth} />
    </GestureDetector>
  );
}

/** Вид графика со скраббингом: подписан на долю (значение для скринридера, курсор) — перерисовывается на кадр. */
function ScrubbableBody({
  elevation,
  distanceM,
  gainM,
  theme,
  label,
  scrub,
  onWidth,
}: ProfileChartProps & { scrub: ScrubStore; onWidth: (width: number) => void }) {
  const fraction = useScrub(scrub, (state) => state.fraction);
  const active = useScrub(scrub, (state) => state.active);
  const onAction = (event: AccessibilityActionEvent) => {
    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    scrub.setState({ fraction: scrubStep(fraction, distanceM, direction), active: true });
  };
  return (
    <View
      testID="elevation-profile-chart"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: scrubReadout(elevation, distanceM, gainM, fraction).valueText }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAction}
      onLayout={(event) => onWidth(event.nativeEvent.layout.width)}
      style={[styles.chart, { borderBottomColor: theme.border.subtle }]}
    >
      <ProfileArea elevation={elevation} theme={theme} />
      {active ? (
        <View
          testID="elevation-profile-cursor"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[
            styles.cursor,
            { left: `${fraction * 100}%`, backgroundColor: theme.action.primary },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    width: '100%',
    aspectRatio: PROFILE_ASPECT_RATIO,
    borderBottomWidth: stroke.hairline,
  },
  area: { flex: 1 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  bar: { flex: 1 },
  cursor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: stroke.indicator,
    marginLeft: -stroke.indicator / 2,
  },
});
