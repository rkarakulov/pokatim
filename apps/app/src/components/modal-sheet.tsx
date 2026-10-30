import { shapeOf, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { textStyle, useReducedMotion, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sheetSurface } from './bottom-sheet-props';

/** Затемнение под окном (доля непрозрачности `overlay.scrim`). */
const SCRIM_OPACITY = 0.4;
/** Окно не выше доли экрана: содержимое прокручивается. */
const MAX_HEIGHT = '90%';

export interface ModalSheetProps {
  /** заголовок окна — он же имя окна для скринридера */
  title: string;
  /** «Назад» Android, Esc web, касание затемнения */
  onClose: () => void;
  /** текст и действия (явное закрытие — у экрана или `headerAction`) */
  children: ReactNode;
  /** `sheet` — шторка снизу (по умолчанию), `dialog` — окно по центру */
  placement?: 'sheet' | 'dialog';
  /** действие сверху справа над прокруткой («×» окна установки PWA) */
  headerAction?: ReactNode;
  /** заголовок рисует содержимое (после картинки-шапки): `title` — только имя окна */
  titleInContent?: boolean;
  testID?: string;
}

/**
 * Модальное окно поверх экрана (iOS, Android, web — `Modal` RN): затемнение, заголовок-heading, содержимое
 * прокручивается. Шторка — поверхность и верхние углы шторки темы (`sheetSurface`) и нижний inset, окно — `surface.sheet`
 * с формой `shapeOf(theme).sheet`. Без жеста: закрытие — действие экрана, затемнение, «Назад»/Esc. Имя окна — у самого
 * `Modal`: на web он и есть `role="dialog"`. Открыто, пока смонтировано: закрытый RN-web `Modal` всё равно рендерит
 * портал — экран монтирует окно только после монтирования (не на SSR). Reduce motion (и `null` до ответа) — без
 * анимации появления.
 */
export function ModalSheet({
  title,
  onClose,
  children,
  placement = 'sheet',
  headerAction,
  titleInContent = false,
  testID,
}: ModalSheetProps) {
  const theme = useTheme<AppTheme>();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const sheet = placement === 'sheet';
  return (
    <Modal
      visible
      transparent
      aria-label={title}
      animationType={reducedMotion === false ? (sheet ? 'slide' : 'fade') : 'none'}
      onRequestClose={onClose}
    >
      <View style={[styles.root, sheet ? styles.rootSheet : styles.rootDialog]}>
        {/* затемнение закрывает касанием; для скринридера и Tab — только действия окна и Esc */}
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
          style={[
            styles.panel,
            { paddingTop: headerAction ? space.s2 : space.s5 },
            sheet
              ? [sheetSurface(theme), styles.sheet, { paddingBottom: insets.bottom + space.s5 }]
              : {
                  backgroundColor: theme.surface.sheet,
                  borderRadius: shapeOf(theme).sheet,
                  paddingBottom: space.s5,
                },
          ]}
        >
          {headerAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          <ScrollView contentContainerStyle={styles.content}>
            {titleInContent ? null : (
              <Text role="heading" style={[textStyle('titleSm'), { color: theme.text.primary }]}>
                {title}
              </Text>
            )}
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootSheet: { justifyContent: 'flex-end' },
  rootDialog: { justifyContent: 'center', padding: size.gutter },
  panel: { maxHeight: MAX_HEIGHT },
  sheet: { borderTopWidth: stroke.hairline },
  headerAction: { alignItems: 'flex-end', paddingHorizontal: space.s2 },
  content: { paddingHorizontal: size.gutter, gap: space.s4 },
});
