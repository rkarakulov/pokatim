import { space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { Banner, Button, TextAction } from '@rkarakulov/ui';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { openPushSettings, usePushSupported } from './push';
import { deniedRow, usePushPermission } from './push-permission-row';
import { loadSoftPromptSnooze, saveSoftPromptSnooze } from './push-soft-prompt-storage';
import {
  anchorOf,
  claimSoftPrompt,
  decideSoftPrompt,
  finishSoftPrompt,
  isOffered,
  releaseSoftPrompt,
  useSoftPromptStore,
} from './push-soft-prompt-store';
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

/**
 * Место подсказки под действием. Показ закреплён за первым местом этого объекта на сфокусированном экране (герой,
 * строка ленты и карточка одного райда — одна подсказка; лента под открытой карточкой её не забирает); владелец
 * размонтирован или его экран потерял фокус — подсказка закрыта до перезапуска. Не владелец — ничего и без запросов
 * состояния push.
 */
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
  const anchor = anchorOf(context, id);
  const [token] = useState(() => ({}));
  const offered = useSoftPromptStore((state) => isOffered(state, anchor));
  const owner = useSoftPromptStore((state) => state.owner === token);
  const focused = useIsFocused();

  useEffect(() => {
    if (offered && focused) claimSoftPrompt(anchor, token);
    if (!focused) releaseSoftPrompt(token);
  }, [offered, focused, anchor, token]);
  useEffect(() => () => releaseSoftPrompt(token), [anchor, token]);

  return owner ? <OfferedPrompt context={context} style={style} /> : null;
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
 * отказ — текст отказа строки без повторного запроса, озвучивается скринридером (фокус не переносится: пользователь
 * остаётся у своего действия). «Не сейчас» — отложка на 30 дней на устройстве.
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
  const phase = useSoftPromptStore((state) => state.phase);
  const [pending, setPending] = useState(false);
  const { permission } = control;

  useEffect(() => {
    if (phase !== 'checking' || supported === null || !permission || snoozedAt === undefined)
      return;
    decideSoftPrompt(softPromptVisible({ supported, permission, snoozedAt, now: Date.now() }));
  }, [phase, supported, permission, snoozedAt]);

  const denied = deniedRow();
  useEffect(() => {
    if (phase === 'denied') AccessibilityInfo.announceForAccessibility(t(denied.message));
  }, [phase, denied.message]);

  if (phase === 'denied') {
    return (
      <View style={style}>
        <Banner
          tone="warning"
          title={t('notifications.push.enable')}
          message={t(denied.message)}
          onPress={denied.action === 'settings' ? () => void openPushSettings() : undefined}
        />
      </View>
    );
  }
  if (phase !== 'offer') return null;

  const enable = async () => {
    setPending(true);
    let next: Awaited<ReturnType<typeof control.press>> = null;
    try {
      next = await control.press();
    } finally {
      setPending(false);
    }
    // запроса не было (строка занята) — подсказка остаётся; выдано или запрос закрыт без ответа — уходит; отказ —
    // остаётся текстом отказа
    if (next) finishSoftPrompt(next.status === 'denied' ? 'denied' : 'closed');
  };
  const later = () => {
    finishSoftPrompt('closed');
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
