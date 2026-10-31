import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { nameHintVisible } from './name-hint-state';
import { loadNameHintSnooze, saveNameHintSnooze } from './name-hint-storage';
import { useNameMissing } from './queries';

/**
 * Подсказка K3 «Добавьте имя — свои увидят вас» (P3; общая с P2 — подсказка после райда, K5): показывает экран, когда
 * у вошедшего нет публичного профиля (`ProfileView.publicId === null`); действие — «Редактировать профиль». «Не
 * сейчас» — только если передан `onLater` (Главная; в своём профиле подсказка не скрывается).
 */
export function NameHint({ onLater }: { onLater?: () => void }) {
  const router = useRouter();
  return (
    <View testID="name-hint" style={styles.hint}>
      <Banner message={t('social.nameHint.title')} />
      <View style={styles.actions}>
        <Button
          label={t('social.nameHint.action')}
          variant="secondary"
          onPress={() => router.push('/settings/profile')}
        />
        {onLater ? <TextAction label={t('social.nameHint.later')} onPress={onLater} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { gap: space.s2, alignSelf: 'stretch' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.s3 },
});

/**
 * Подсказка K3 на Главной: вошедшему без публичного профиля, отложка прочитана и старше 14 дней (пока читается — не
 * показываем, без мигания). «Не сейчас» скрывает сразу и пишет отложку на устройстве; сбой записи — скрыта до
 * перезапуска.
 */
export function useHomeNameHint(signedIn: boolean): { visible: boolean; later: () => void } {
  const missing = useNameMissing(signedIn);
  // отложка прочитана и проверена по часам — в эффекте (не в рендере); `null` — ещё читается
  const [snoozeAllows, setSnoozeAllows] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void loadNameHintSnooze().then((snoozedAt) => {
      if (active) setSnoozeAllows((current) => current ?? nameHintVisible(snoozedAt, Date.now()));
    });
    return () => {
      active = false;
    };
  }, []);
  const later = () => {
    setSnoozeAllows(false);
    void saveNameHintSnooze(Date.now());
  };
  return { visible: missing === true && snoozeAllows === true, later };
}
