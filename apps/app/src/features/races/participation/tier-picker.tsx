import type { MyRaceEntry } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { raceActionErrorText, tierLabel } from '../participation-format';
import { useEnterRace } from '../queries';
import { VerifiedChoice } from './group-picker';

/** Уровень с коротким объяснением: заголовок, что даёт, действие. */
function TierOption({
  tier,
  hint,
  children,
}: {
  tier: 'verified' | 'start';
  hint: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View testID={`tier-${tier}`} style={[styles.option, { borderTopColor: theme.border.subtle }]}>
      <Text
        accessibilityRole="header"
        style={[textStyle('titleSm'), { color: theme.text.primary }]}
      >
        {tierLabel(tier)}
      </Text>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{hint}</Text>
      {children}
    </View>
  );
}

/**
 * Заявка с выбором уровня (race-results-07, схема `gender_age`): Verified — анкета (если нет) и группа зачёта; START
 * — сразу. Ответ сервера — в кеш участия; отказ — баннер по коду (`VERIFIED_PROFILE_REQUIRED` перезапрашивает участие
 * — блок покажет «Заполнить анкету»).
 */
export function TierPicker({ entry, raceId }: { entry: MyRaceEntry; raceId: string }) {
  const theme = useTheme();
  const enter = useEnterRace(raceId);
  const pendingTier = enter.isPending ? enter.variables?.tier : undefined;
  return (
    <View style={styles.picker}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('races.tier.title')}
      </Text>
      <TierOption tier="verified" hint={t('races.tier.verifiedHint')}>
        <VerifiedChoice
          entry={entry}
          raceId={raceId}
          submitLabel={t('races.tier.enterVerified')}
          pending={pendingTier === 'verified'}
          onSubmit={(groupKey) => enter.mutate({ tier: 'verified', groupKey })}
        />
      </TierOption>
      <TierOption tier="start" hint={t('races.tier.startHint')}>
        <Button
          label={t('races.tier.enterStart')}
          variant="secondary"
          loading={pendingTier === 'start'}
          onPress={() => enter.mutate({ tier: 'start' })}
        />
      </TierOption>
      {enter.error ? <Banner tone="error" message={raceActionErrorText(enter.error)} /> : null}
    </View>
  );
}

/**
 * «Повысить до Verified» в «моём участии» — только по `actions.canUpgrade` сервера (START, окно открыто, схема
 * `gender_age`). Раскрывается: объяснение, анкета или группа, подтверждение; «Не сейчас» сворачивает.
 */
export function UpgradeAction({ entry, raceId }: { entry: MyRaceEntry; raceId: string }) {
  const theme = useTheme();
  const enter = useEnterRace(raceId);
  const [open, setOpen] = useState(false);
  if (!entry.actions.canUpgrade || entry.verified === null) return null;
  if (!open) {
    return (
      <View style={styles.start}>
        <TextAction
          label={t('races.tier.upgrade')}
          onPress={() => {
            enter.reset();
            setOpen(true);
          }}
        />
      </View>
    );
  }
  return (
    <View testID="tier-upgrade" style={[styles.option, { borderTopColor: theme.border.subtle }]}>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('races.tier.upgradeHint')}
      </Text>
      <VerifiedChoice
        entry={entry}
        raceId={raceId}
        submitLabel={t('races.tier.upgrade')}
        pending={enter.isPending}
        onSubmit={(groupKey) => enter.mutate({ tier: 'verified', groupKey })}
      />
      {enter.error ? <Banner tone="error" message={raceActionErrorText(enter.error)} /> : null}
      <View style={styles.start}>
        <TextAction label={t('races.tier.upgradeCancel')} onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: space.s3 },
  option: { gap: space.s2, paddingTop: space.s3, borderTopWidth: stroke.hairline },
  start: { alignItems: 'flex-start' },
});
