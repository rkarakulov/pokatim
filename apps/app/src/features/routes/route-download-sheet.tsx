import type { RouteExportFormat } from '@pokatim/contracts';
import { space, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { ModalSheet } from '@/components/modal-sheet';

/**
 * Шит «Скачать маршрут» (routes-formats, RC-8): по secondary-кнопке на доступный формат во всю ширину с подписью
 * «для чего формат» (она же `accessibilityHint` кнопки) и явное «Закрыть». Выбор — `onPick(format)`: экран
 * вызывает `downloadFile` синхронно в том же обработчике (web: `<a download>` до любого await) и закрывает шит.
 * Монтируется только после монтирования экрана.
 */
export function RouteDownloadSheet({
  formats,
  onPick,
  onClose,
}: {
  formats: readonly RouteExportFormat[];
  onPick: (format: RouteExportFormat) => void;
  onClose: () => void;
}) {
  const theme = useTheme<AppTheme>();
  return (
    <ModalSheet
      title={t('routes.detail.downloadTitle')}
      onClose={onClose}
      testID="route-download-sheet"
    >
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('routes.detail.downloadText')}
      </Text>
      <View style={styles.options}>
        {formats.map((format) => (
          // «для чего формат» — подсказка скринридеру у кнопки; видимая подпись дублирует её и от скринридера скрыта
          <View key={format} testID={`route-download-option-${format}`} style={styles.option}>
            <Button
              label={t(`routes.detail.format.${format}`)}
              accessibilityHint={t(`routes.detail.formatHint.${format}`)}
              variant="secondary"
              onPress={() => onPick(format)}
            />
            <Text aria-hidden style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t(`routes.detail.formatHint.${format}`)}
            </Text>
          </View>
        ))}
        <View style={styles.close}>
          <TextAction label={t('routes.detail.downloadClose')} onPress={onClose} />
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  options: { gap: space.s4 },
  option: { gap: space.s1 },
  close: { alignItems: 'center' },
});
