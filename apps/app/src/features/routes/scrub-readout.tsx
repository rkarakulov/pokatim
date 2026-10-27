import type { CatalogRouteElevation } from '@pokatim/contracts';
import { space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { textStyle } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useScrub, type ScrubStore } from '@/features/maps/scrub-store';

import { profileRangeLabel } from './format';
import { scrubReadout } from './scrub';

const SEPARATOR = ' · ';

/**
 * Правая часть заголовка профиля (routes-04, RC-7): курсор активен — карточка «12,4 км · 231 м · ↗ 4 % · набор
 * 180 м» на месте диапазона, иначе диапазон «191–267 м». Подписан на стор только этот элемент; карточка скрыта от
 * скринридера (значение озвучивает график), без анимации появления (RC-12).
 */
export function ProfileHeadValue({
  elevation,
  distanceM,
  gainM,
  theme,
  scrub,
}: {
  elevation: CatalogRouteElevation;
  distanceM: number;
  gainM: number | null;
  theme: AppTheme;
  scrub: ScrubStore | undefined;
}) {
  const range = (
    <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
      {profileRangeLabel(elevation)}
    </Text>
  );
  if (!scrub) return range;
  return (
    <ScrubHead
      elevation={elevation}
      distanceM={distanceM}
      gainM={gainM}
      theme={theme}
      scrub={scrub}
      range={range}
    />
  );
}

function ScrubHead({
  elevation,
  distanceM,
  gainM,
  theme,
  scrub,
  range,
}: {
  elevation: CatalogRouteElevation;
  distanceM: number;
  gainM: number | null;
  theme: AppTheme;
  scrub: ScrubStore;
  range: ReactNode;
}) {
  const fraction = useScrub(scrub, (state) => (state.active ? state.fraction : null));
  if (fraction === null) return range;
  const readout = scrubReadout(elevation, distanceM, gainM, fraction);
  return (
    <View
      testID="scrub-readout"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.card,
        { backgroundColor: theme.surface.raised, borderColor: theme.border.subtle },
      ]}
    >
      <Text style={[textStyle('label'), { color: theme.text.primary }]}>
        {[readout.distance, readout.elevation, readout.grade, readout.gain].join(SEPARATOR)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexShrink: 1,
    paddingHorizontal: space.s2,
    borderWidth: stroke.hairline,
  },
});
