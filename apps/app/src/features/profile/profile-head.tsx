import { layout, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Skeleton, SkeletonGroup, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { RiderAvatar } from '@/components/rider-avatar';

/**
 * Шапка профиля (`.phead` / `.prule` прототипа; свой и публичный профиль): аватар 56 на `surface.default`, имя
 * крупно, под ним личная линия — клуб между линией `text.primary` и `border.subtle`. Клуба нет — линия без текста
 * (`.prule.empty`). Высота — по содержимому (D-B1): контура «Личной линии» в данных нет, пустая поверхность
 * `heroHeight` была бы заглушкой. Имени нет (свой профиль) — «Имя не указано» вторичным цветом.
 */
export function ProfileHead({
  name,
  club,
  avatarId,
}: {
  name: string | null;
  club: string | null;
  avatarId: string | null;
}) {
  const theme = useTheme();
  return (
    <View testID="profile-head">
      <View style={[styles.head, { backgroundColor: theme.surface.raised }]}>
        <View style={styles.avatar}>
          <RiderAvatar avatarId={avatarId} dimension={layout.avatarProfile} background="default" />
        </View>
        <Text
          accessibilityRole="header"
          style={[
            textStyle('displayTitle'),
            { color: name === null ? theme.text.secondary : theme.text.primary },
          ]}
        >
          {name ?? t('profile.noName')}
        </Text>
      </View>
      <View
        testID="profile-rule"
        style={[
          styles.rule,
          club === null ? styles.ruleEmpty : null,
          { borderTopColor: theme.text.primary, borderBottomColor: theme.border.subtle },
        ]}
      >
        {club !== null ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{club}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Скелетон шапки — та же раскладка: квадрат аватара, строка имени, линия. */
export function ProfileHeadSkeleton() {
  const theme = useTheme();
  return (
    <SkeletonGroup>
      <View style={[styles.head, { backgroundColor: theme.surface.raised }]}>
        <View style={styles.avatar}>
          <Skeleton width={layout.avatarProfile} height={layout.avatarProfile} />
        </View>
        <SkeletonText variant="displayTitle" lastLineWidth="60%" />
      </View>
      <View
        style={[
          styles.rule,
          styles.ruleEmpty,
          { borderTopColor: theme.text.primary, borderBottomColor: theme.border.subtle },
        ]}
      />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: size.gutter, paddingVertical: space.s4 },
  avatar: { marginBottom: space.s3, alignItems: 'flex-start' },
  rule: {
    marginHorizontal: size.gutter,
    paddingVertical: space.s2,
    borderTopWidth: stroke.hairline,
    borderBottomWidth: stroke.hairline,
  },
  ruleEmpty: { paddingVertical: 0 },
});
