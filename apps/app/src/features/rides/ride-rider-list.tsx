import type { RideRiderGroup, RideRiderRow } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RiderAvatar } from '@/components/rider-avatar';
import { riderPath } from '@/features/riders/queries';

/** Строк до раскрытия «Показать всех» (K4). */
export const COLLAPSED_ROWS = 5;

function RiderRowView({ row }: { row: RideRiderRow }) {
  const theme = useTheme();
  const router = useRouter();
  const content = (
    <>
      <RiderAvatar avatarId={row.avatar?.id ?? null} dimension={size.avatarStack} decorative />
      <Text
        numberOfLines={1}
        style={[textStyle('body'), styles.name, { color: theme.text.primary }]}
      >
        {row.name}
      </Text>
    </>
  );
  const publicId = row.publicId;
  if (publicId === null) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('rides.participants.profileA11y', { name: row.name })}
      onPress={() => router.push(riderPath(publicId))}
      style={styles.row}
    >
      {content}
    </Pressable>
  );
}

/**
 * Публичные райдеры райда (K4, RC-8): до `collapsedRows` строк «аватар · имя» (с `publicId` — ссылка на профиль), затем
 * «и ещё N» (`hiddenCount` — непубличные, не меняется после раскрытия) и «Показать всех» (только при большем числе
 * публичных строк: раскрывает остальные на месте и пропадает). Порядок — сервера (организатор первым).
 */
export function RideRiderList({
  group,
  collapsedRows = COLLAPSED_ROWS,
}: {
  group: RideRiderGroup;
  collapsedRows?: number;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? group.riders : group.riders.slice(0, collapsedRows);
  const canExpand = !expanded && group.riders.length > collapsedRows;
  return (
    <View style={styles.list}>
      {rows.map((row, index) => (
        <RiderRowView key={`${row.publicId ?? 'row'}-${index}`} row={row} />
      ))}
      {group.hiddenCount > 0 ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('rides.participants.more', { count: group.hiddenCount })}
        </Text>
      ) : null}
      {canExpand ? (
        <View style={styles.start}>
          <TextAction label={t('rides.participants.showAll')} onPress={() => setExpanded(true)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.s2 },
  row: { minHeight: size.touchMin, flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  name: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
