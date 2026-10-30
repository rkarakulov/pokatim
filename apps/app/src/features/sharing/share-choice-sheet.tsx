import { space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';
import { shareLink, type ShareLinkInput } from '@/lib/share-link';

type ShareNotice = 'copied' | 'failed' | null;

export interface ShareChoiceSheetProps {
  title: string;
  /** пояснение под заголовком */
  text?: string;
  /** подпись пункта карточки («Карточка для сторис», «Карточка-приглашение») */
  cardLabel: string;
  onCard: () => void;
  /** ссылка на публичную страницу (с OG-картинкой файлом, если готова); `null` — пункта «Ссылка» нет */
  link: ShareLinkInput | null;
  onClose: () => void;
  /** ссылка отправлена; нет — шит закрывается (`onClose`) */
  onShared?: () => void;
  testID?: string;
}

/**
 * Выбор «Карточка для сторис / Ссылка» (route-story-card, RC-1): карточка (primary) — экран карточки, «Ссылка»
 * (secondary) — `shareLink` синхронно в обработчике нажатия (web: `navigator.share` — до любого await, RC-13),
 * «Закрыть». Ссылка отправлена — `onShared` (по умолчанию закрыть); меню закрыли — шит остаётся; web без Web Share —
 * «Ссылка скопирована» в шите. Монтировать только после монтирования экрана (закрытый RN-web `Modal` рендерит портал).
 */
export function ShareChoiceSheet({
  title,
  text,
  cardLabel,
  onCard,
  link,
  onClose,
  onShared,
  testID,
}: ShareChoiceSheetProps) {
  const theme = useTheme<AppTheme>();
  const [notice, setNotice] = useState<ShareNotice>(null);
  const [sharing, setSharing] = useState(false);

  const share = (input: ShareLinkInput) => {
    setNotice(null);
    setSharing(true);
    shareLink(input)
      .then((outcome) => {
        if (outcome === 'shared') (onShared ?? onClose)();
        else setNotice(outcome === 'copied' ? 'copied' : null);
      })
      .catch(() => setNotice('failed'))
      .finally(() => setSharing(false));
  };

  return (
    <ModalSheet title={title} onClose={onClose} {...(testID ? { testID } : {})}>
      {text ? (
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{text}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button label={cardLabel} onPress={onCard} />
        {link ? (
          <Button
            label={t('share.choice.link')}
            variant="secondary"
            disabled={sharing}
            onPress={() => share(link)}
          />
        ) : null}
        <ShareNoticeBanner notice={notice} />
        <View style={styles.close}>
          <TextAction label={t('share.choice.close')} onPress={onClose} />
        </View>
      </View>
    </ModalSheet>
  );
}

function ShareNoticeBanner({ notice }: { notice: ShareNotice }) {
  if (notice === 'copied') return <Banner message={t('share.choice.copied')} />;
  if (notice === 'failed') return <Banner tone="warning" message={t('share.choice.failed')} />;
  return null;
}

/**
 * Кнопка «Поделиться» с выбором (R7): доступны оба пути — нажатие открывает шит; только ссылка (гость, нет права
 * карточки) — сразу `shareLink`; только карточка (нет web-origin — dev native) — сразу экран карточки; ни одного —
 * `available: false` (кнопки нет). Экран рисует кнопку (`press`), уведомление прямой ссылки (`notice`) и шит (`sheet`).
 */
export function useShareChoice({
  title,
  cardLabel,
  onCard,
  link,
}: {
  title: string;
  cardLabel: string;
  /** переход на экран карточки; `null` — карточки нет */
  onCard: (() => void) | null;
  link: ShareLinkInput | null;
}): { available: boolean; press: () => void; notice: ReactNode; sheet: ReactNode } {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<ShareNotice>(null);

  const press = () => {
    setNotice(null);
    if (onCard && link) {
      setOpen(true);
      return;
    }
    if (link) {
      // синхронно в обработчике нажатия (web: `navigator.share` до любого await)
      shareLink(link)
        .then((outcome) => setNotice(outcome === 'copied' ? 'copied' : null))
        .catch(() => setNotice('failed'));
      return;
    }
    onCard?.();
  };

  const sheet =
    open && onCard && link ? (
      <ShareChoiceSheet
        title={title}
        cardLabel={cardLabel}
        link={link}
        onCard={() => {
          setOpen(false);
          onCard();
        }}
        onClose={() => setOpen(false)}
        testID="share-choice-sheet"
      />
    ) : null;

  return {
    available: onCard !== null || link !== null,
    press,
    notice: <ShareNoticeBanner notice={notice} />,
    sheet,
  };
}

const styles = StyleSheet.create({
  actions: { gap: space.s2 },
  close: { alignItems: 'center' },
});
