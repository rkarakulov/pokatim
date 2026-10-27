import type { MyRaceEntry, ResultGroupKey } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, Chip, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { groupChoices, groupLabel } from '../participation-format';

/** Путь анкеты зачёта с возвратом к гонке после сохранения. */
export const verifiedProfilePath = (raceId: string) => `/settings/verified?race=${raceId}`;

/**
 * Verified-часть заявки и повышения (race-results-07): анкеты нет — «Заполнить анкету» (возврат к гонке); есть —
 * группа зачёта из `verified.groupOptions` сервера (своя по умолчанию, младшие своего пола) и кнопка действия.
 * Правила групп — только сервер (DV-8): клиент показывает готовый список.
 */
export function VerifiedChoice({
  entry,
  raceId,
  submitLabel,
  pending,
  onSubmit,
}: {
  entry: MyRaceEntry;
  raceId: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (groupKey: ResultGroupKey) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const choices = groupChoices(entry);
  const own = entry.verified?.ownGroup;
  const fallback = choices?.find((key) => key === own) ?? choices?.[0] ?? null;
  const [picked, setPicked] = useState<ResultGroupKey | null>(null);
  const selected = picked !== null && choices?.includes(picked) ? picked : fallback;
  const meta = [textStyle('meta'), { color: theme.text.secondary }];

  if (choices === null || selected === null) {
    return (
      <View style={styles.stack}>
        <Text style={meta}>{t('races.tier.profileRequired')}</Text>
        <Button
          label={t('races.tier.fillProfile')}
          variant="secondary"
          onPress={() => router.push(verifiedProfilePath(raceId))}
        />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('races.tier.group')}
      </Text>
      {choices.length > 1 ? (
        // роль radio у `Chip` — задача в app-foundation (RC-9 maps-02); группа — radiogroup с подписью
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('races.tier.group')}
          testID="group-picker"
          style={styles.chips}
        >
          {choices.map((key) => (
            <Chip
              key={key}
              label={groupLabel(key)}
              selected={key === selected}
              onPress={() => setPicked(key)}
            />
          ))}
        </View>
      ) : (
        <Text style={[textStyle('body'), { color: theme.text.primary }]}>
          {groupLabel(selected)}
        </Text>
      )}
      <Text style={meta}>{t('races.tier.groupHint')}</Text>
      <Button label={submitLabel} loading={pending} onPress={() => onSubmit(selected)} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
