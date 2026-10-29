import { shapeOf, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useReducedMotion, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sheetSurface } from '@/components/bottom-sheet-props';

import { InstallCloseButton } from './install-close-button';
import type { InstallImage } from './install-images';

/** Затемнение под окном (доля непрозрачности `overlay.scrim`). */
const SCRIM_OPACITY = 0.4;
/** Окно не выше доли экрана: содержимое прокручивается. */
const MAX_HEIGHT = '90%';

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
 * Окно установки PWA поверх экрана (только web): затемнение закрывает, «×» сверху справа, содержимое по центру и
 * прокручивается. Шторка — поверхность и верхние углы шторки темы (`sheetSurface`), без жеста: закрытие — «×»,
 * затемнение и Esc. Reduce motion — без анимации появления.
 */
export function InstallModal({ placement, title, onClose, children, testID }: InstallModalProps) {
  const theme = useTheme<AppTheme>();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const sheet = placement === 'sheet';
  return (
    <Modal
      visible
      transparent
      animationType={reducedMotion ? 'none' : sheet ? 'slide' : 'fade'}
      onRequestClose={onClose}
    >
      <View style={[styles.root, sheet ? styles.rootSheet : styles.rootDialog]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pwaInstall.close')}
          onPress={onClose}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.overlay.scrim, opacity: SCRIM_OPACITY },
          ]}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          aria-label={title}
          style={[
            styles.panel,
            sheet
              ? [sheetSurface(theme), styles.sheet, { paddingBottom: insets.bottom + space.s5 }]
              : {
                  backgroundColor: theme.surface.sheet,
                  borderRadius: shapeOf(theme).sheet,
                  paddingBottom: space.s5,
                },
          ]}
        >
          <View style={styles.close}>
            <InstallCloseButton onPress={onClose} testID="pwa-install-modal-close" />
          </View>
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
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
  root: { flex: 1 },
  rootSheet: { justifyContent: 'flex-end' },
  rootDialog: { justifyContent: 'center', padding: size.gutter },
  panel: { maxHeight: MAX_HEIGHT, paddingTop: space.s2 },
  sheet: { borderTopWidth: stroke.hairline },
  close: { alignItems: 'flex-end', paddingHorizontal: space.s2 },
  content: { paddingHorizontal: size.gutter, gap: space.s4, alignItems: 'stretch' },
  center: { textAlign: 'center' },
  picture: { width: '100%' },
  fill: { width: '100%', height: '100%' },
});
