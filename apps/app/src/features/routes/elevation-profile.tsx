import type { CatalogRouteElevation } from '@pokatim/contracts';
import { space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import type { ScrubStore } from '@/features/maps/scrub-store';

import { profileSummary, profileTicks } from './format';
import { ProfileChart } from './profile-chart';
import { ProfileHeadValue } from './scrub-readout';

export { PROFILE_ASPECT_RATIO } from './profile-style';

/** Подпись оси X правее этой доли длины — выравнивание по правому краю (не выходит за край графика). */
const TICK_ALIGN_END_FROM = 0.85;

/**
 * Профиль высоты маршрута (routes-03, P4, RC-7): заголовок, справа — диапазон «191–267 м» или карточка курсора
 * (routes-04), график `ProfileChart` (web — плавный SVG-путь, native — узкие столбики; без `onLayout` в раскладке —
 * SSR и первый клиентский рендер совпадают), подписи оси X в км. Для скринридера — один элемент графика с текстовой
 * альтернативой: без `scrub` — изображение, со `scrub` — `adjustable` / `slider` (S4). Профиля нет — блока нет.
 */
export function ElevationProfile({
  elevation,
  distanceM,
  gainM,
  scrub,
}: {
  elevation: CatalogRouteElevation | null;
  distanceM: number;
  gainM: number | null;
  /** routes-04: стор скраббинга экрана (курсор, карточка, связь с маркером карты) */
  scrub?: ScrubStore;
}) {
  const theme = useTheme<AppTheme>();
  if (elevation === null) return null;
  const ticks = profileTicks(distanceM);
  const muted = { color: theme.text.secondary };
  return (
    <View testID="elevation-profile" style={styles.block}>
      <View style={styles.head}>
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), styles.title, { color: theme.text.primary }]}
        >
          {t('routes.detail.profile.title')}
        </Text>
        <ProfileHeadValue
          elevation={elevation}
          distanceM={distanceM}
          gainM={gainM}
          theme={theme}
          scrub={scrub}
        />
      </View>
      <ProfileChart
        elevation={elevation}
        distanceM={distanceM}
        gainM={gainM}
        theme={theme}
        label={profileSummary(elevation, gainM)}
        scrub={scrub}
      />
      <View
        style={styles.axis}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {ticks.map((tick) => (
          <Text
            key={tick.km}
            style={[
              textStyle('label'),
              muted,
              styles.tick,
              tick.position > TICK_ALIGN_END_FROM
                ? { right: `${(1 - tick.position) * 100}%` }
                : { left: `${tick.position * 100}%` },
            ]}
          >
            {tick.label}
          </Text>
        ))}
        {/* высота строки подписей — невидимый образец (подписи позиционированы абсолютно) */}
        <Text style={[textStyle('label'), styles.spacer]}> </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s2 },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.s2,
  },
  title: { flexShrink: 1 },
  axis: { position: 'relative', width: '100%' },
  tick: { position: 'absolute', top: 0 },
  spacer: { opacity: 0 },
});
