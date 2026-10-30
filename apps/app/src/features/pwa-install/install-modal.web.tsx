import type { AppTheme } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';

import { InstallCloseButton } from './install-close-button';
import type { InstallImage } from './install-images';

/** Окно открыто, пока смонтировано (закрытый RN-web `Modal` всё равно рендерит портал — на SSR нельзя). */
export interface InstallModalProps {
  /** `sheet` — шторка снизу (инструкция iOS), `dialog` — окно по центру (промо) */
  placement: 'sheet' | 'dialog';
  /** имя окна для скринридера — текст заголовка (`InstallTitle`) */
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * Окно установки PWA поверх экрана (только web) — общий `ModalSheet`: «×» сверху справа, заголовок рисует
 * содержимое (`InstallTitle` после картинки-шапки).
 */
export function InstallModal({ placement, title, onClose, children, testID }: InstallModalProps) {
  return (
    <ModalSheet
      placement={placement}
      title={title}
      titleInContent
      onClose={onClose}
      headerAction={<InstallCloseButton onPress={onClose} testID="pwa-install-modal-close" />}
      testID={testID}
    >
      {children}
    </ModalSheet>
  );
}

/** Картинка инструкции во всю ширину (`height: auto` — по пропорции); смысл несёт текст рядом. */
export function InstallPicture({ image, testID }: { image: InstallImage; testID?: string }) {
  // пропорция — у обёртки: без явных `width`/`height` RN-web даёт `Image` натуральный размер ассета
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.picture, { aspectRatio: image.aspectRatio }]}
    >
      <Image source={image.source} resizeMode="contain" style={styles.fill} />
    </View>
  );
}

/** Заголовок окна (после картинки-шапки). */
export function InstallTitle({ children }: { children: string }) {
  const theme = useTheme<AppTheme>();
  return (
    <Text
      role="heading"
      style={[textStyle('titleSm'), styles.center, { color: theme.text.primary }]}
    >
      {children}
    </Text>
  );
}

/** Абзац инструкции по центру. */
export function InstallText({ children }: { children: string }) {
  const theme = useTheme<AppTheme>();
  return (
    <Text style={[textStyle('body'), styles.center, { color: theme.text.primary }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  picture: { width: '100%' },
  fill: { width: '100%', height: '100%' },
});
