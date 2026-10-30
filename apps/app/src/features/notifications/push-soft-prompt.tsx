import { space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { Banner, Button, TextAction } from '@rkarakulov/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { openPushSettings, usePushSupported } from './push';
import { deniedRow, usePushPermission } from './push-permission-row';
import { loadSoftPromptSnooze, saveSoftPromptSnooze } from './push-soft-prompt-storage';
import { anchorOf, closeSoftPrompt, useSoftPromptStore } from './push-soft-prompt-store';
import { softPromptVisible, type SoftPromptContext } from './push-soft-prompt-state';

/**
 * Подсказка «Включить уведомления» в момент пользы (N5): после успешного «Я иду» и записи на гонку. Предложение —
 * `offerPushSoftPrompt` (`push-soft-prompt-store.ts`) из успеха мутации, показ — `PushSoftPrompt` с тем же объектом
 * под действием (переживает смену блока: «Участвовать» уходит, приходит «Ваше участие»).
 */
const TEXTS: Record<SoftPromptContext, { title: MessageKey; message: MessageKey }> = {
  ride: {
    title: 'notifications.softPrompt.rideTitle',
    message: 'notifications.softPrompt.rideMessage',
  },
  race: {
    title: 'notifications.softPrompt.raceTitle',
    message: 'notifications.softPrompt.raceMessage',
  },
};

/** Место подсказки под действием; пока ей не предложено это место — ничего и без запросов состояния push. */
export function PushSoftPrompt({
  context,
  id,
  style,
}: {
  context: SoftPromptContext;
  id: string;
  /** отступы места (строка ленты); пока подсказки нет — места нет */
  style?: StyleProp<ViewStyle>;
}) {
  const offered = useSoftPromptStore((state) => state.offer === anchorOf(context, id));
  return offered ? <OfferedPrompt context={context} style={style} /> : null;
}

function useSnoozedAt(): number | null | undefined {
  const [snoozedAt, setSnoozedAt] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadSoftPromptSnooze().then((value) => {
      if (active) setSnoozedAt(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return snoozedAt;
}

/**
 * Решение о показе — один раз, когда известны поддержка, разрешение и отложка (до этого — ничего, без мигания).
 * «Включить» — тот же путь, что строка `PushPermissionRow` (системный запрос из нажатия, выдано — регистрация);
 * отказ — текст отказа строки без повторного запроса. «Не сейчас» — отложка на 30 дней на устройстве.
 */
function OfferedPrompt({
  context,
  style,
}: {
  context: SoftPromptContext;
  style: StyleProp<ViewStyle>;
}) {
  const supported = usePushSupported();
  const control = usePushPermission();
  const snoozedAt = useSnoozedAt();
  // предложение принято (показ этого запуска) — оно и есть «видна»: место смонтировано только у предложенного объекта
  const visible = useSoftPromptStore((state) => state.shown);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState(false);
  const { permission } = control;

  useEffect(() => {
    if (visible || supported === null || !permission || snoozedAt === undefined) return;
    if (softPromptVisible({ supported, permission, snoozedAt, now: Date.now() })) {
      useSoftPromptStore.setState({ shown: true });
    } else {
      closeSoftPrompt();
    }
  }, [visible, supported, permission, snoozedAt]);

  // ответ на системный запрос: выдано или запрос закрыт без ответа — подсказка уходит; отказ — остаётся текстом
  const denied = asked && permission?.status === 'denied';
  useEffect(() => {
    if (asked && !denied) closeSoftPrompt();
  }, [asked, denied]);

  if (!visible) return null;

  if (denied) {
    const row = deniedRow();
    return (
      <View style={style}>
        <Banner
          tone="warning"
          title={t('notifications.push.enable')}
          message={t(row.message)}
          onPress={row.action === 'settings' ? () => void openPushSettings() : undefined}
        />
      </View>
    );
  }
  if (asked) return null;

  const enable = async () => {
    setPending(true);
    try {
      await control.press();
    } finally {
      setPending(false);
    }
    setAsked(true);
  };
  const later = () => {
    closeSoftPrompt();
    void saveSoftPromptSnooze(Date.now());
  };

  return (
    <View testID="push-soft-prompt" style={[styles.prompt, style]}>
      <Banner title={t(TEXTS[context].title)} message={t(TEXTS[context].message)} />
      <View style={styles.actions}>
        <Button
          label={t('notifications.softPrompt.enable')}
          variant="secondary"
          loading={pending}
          onPress={() => void enable()}
        />
        <TextAction
          label={t('notifications.softPrompt.later')}
          disabled={pending}
          onPress={later}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: { gap: space.s2 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.s3 },
});
