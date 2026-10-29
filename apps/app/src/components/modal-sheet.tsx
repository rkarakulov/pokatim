import { size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { textStyle, useReducedMotion, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sheetSurface } from './bottom-sheet-props';

/** Затемнение под шитом (доля непрозрачности `overlay.scrim`, как у окна установки PWA). */
const SCRIM_OPACITY = 0.4;
/** Шит не выше доли экрана: содержимое прокручивается. */
const MAX_HEIGHT = '90%';

export interface ModalSheetProps {
  /** заголовок шита — он же имя окна для скринридера */
  title: string;
  /** «Назад» Android, Esc web, касание затемнения */
  onClose: () => void;
  /** текст и действия (явное «Закрыть» — у экрана) */
  children: ReactNode;
  testID?: string;
}

/**
 * Модальный шит снизу поверх экрана (iOS, Android, web — `Modal` RN): затемнение, поверхность и верхние углы шторки
 * темы (`sheetSurface`), заголовок-heading, нижний inset. Без жеста: закрытие — действие экрана, затемнение,
 * «Назад»/Esc. Открыт, пока смонтирован: закрытый RN-web `Modal` всё равно рендерит портал — экран монтирует шит
 * только после монтирования (не на SSR). Reduce motion (и `null` до ответа) — без анимации появления.
 */
export function ModalSheet({ title, onClose, children, testID }: ModalSheetProps) {
  const theme = useTheme<AppTheme>();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      transparent
      animationType={reducedMotion === false ? 'slide' : 'none'}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* затемнение закрывает касанием; для скринридера и Tab — только действия шита и Esc */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          tabIndex={-1}
          testID={testID ? `${testID}-scrim` : undefined}
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
          style={[sheetSurface(theme), styles.sheet, { paddingBottom: insets.bottom + space.s5 }]}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text role="heading" style={[textStyle('titleSm'), { color: theme.text.primary }]}>
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: MAX_HEIGHT, paddingTop: space.s5, borderTopWidth: stroke.hairline },
  content: { paddingHorizontal: size.gutter, gap: space.s4 },
});
