import type { PublicRiderAchievement } from '@pokatim/contracts';
import { layout, motion, size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SkeletonGroup, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { loading, TabFailure, type TabQuery } from '@/features/races/results-table';

import {
  achievementA11y,
  achievementKey,
  achievementTitle,
  knownItems,
  publicItems,
  type KnownAchievement,
} from './achievement-catalog';
import { AchievementBadge } from './achievement-badge';
import { BadgeSkeleton } from './achievement-card';
import { isNotFound } from './queries';

/** Плиток в скелетоне первой загрузки (одна строка сетки). */
const SKELETON_TILES = 3;
/** Ширина плитки: значок и подпись в две строки под ним. */
const TILE_WIDTH = layout.badgeGrid + space.s5;

function Tile({
  item,
  onPress,
}: {
  item: KnownAchievement<PublicRiderAchievement>;
  onPress?: (item: KnownAchievement<PublicRiderAchievement>) => void;
}) {
  const theme = useTheme();
  const body = (
    <>
      <AchievementBadge code={item.code} level={item.level} size={layout.badgeGrid} />
      <Text
        numberOfLines={2}
        style={[textStyle('meta'), styles.caption, { color: theme.text.primary }]}
      >
        {achievementTitle(item.code)}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={achievementA11y(item)} style={styles.tile}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={achievementA11y(item)}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function TilesSkeleton() {
  return (
    <SkeletonGroup>
      <View style={styles.grid}>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <View key={index} style={styles.tile}>
            <BadgeSkeleton size={layout.badgeGrid} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/**
 * Блок «Достижения» (A7, A8, AC12): сетка значков «Эмаль» в порядке сервера (от новых фактов к старым). Только
 * полученные; известных нет и ошибки нет — блока нет (без пустого состояния). Первая загрузка — скелетон; ошибка —
 * компактный баннер с повтором, экран профиля не ломается (§4.12); ошибка обновления — данные остаются + баннер. 404
 * (публичный профиль скрыли между запросами) — блока нет. `onPress` — свой профиль (экран достижения); без него —
 * плитки без перехода (публичный профиль).
 */
export function AchievementsBlock({
  query,
  onPress,
  publicOnly = false,
  testID,
}: {
  query: TabQuery & { data: { items: readonly PublicRiderAchievement[] } | undefined };
  onPress?: (item: KnownAchievement<PublicRiderAchievement>) => void;
  /** публичный профиль: только гоночные и сезонные (A7, S6) */
  publicOnly?: boolean;
  testID: string;
}) {
  const theme = useTheme();
  if (isNotFound(query.error)) return null;
  const known = query.data ? knownItems(query.data.items) : undefined;
  const items = known && publicOnly ? publicItems(known) : known;
  if (items?.length === 0 && !query.isError) return null;
  return (
    <View testID={testID} style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {t('achievements.title')}
      </Text>
      <TabFailure query={query} message={t('achievements.failed')} />
      {items === undefined ? (
        loading(query) ? (
          <TilesSkeleton />
        ) : null
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <Tile key={achievementKey(item)} item={item} {...(onPress ? { onPress } : {})} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s4 },
  tile: { width: TILE_WIDTH, minHeight: size.touchMin, alignItems: 'center', gap: space.s2 },
  caption: { textAlign: 'center' },
  pressed: { opacity: motion.pressedOpacity },
});
