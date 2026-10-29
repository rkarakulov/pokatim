import type { EventMaterial } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Kicker,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { materialAction, materialIcon, materialMeta } from '@/features/tickets/materials-format';
import { downloadFile } from '@/lib/download-file';
import { openExternalUrl } from '@/lib/open-external-url';

import { Icon } from './icon';

/** Заголовок блока «Материалы» — общий для списка, скелетона и ошибки. */
export function EventMaterialsSection({ children }: { children: ReactNode }) {
  return (
    <View testID="event-materials" style={styles.section}>
      <Kicker label={t('tickets.materials.title')} />
      {children}
    </View>
  );
}

function MaterialRow({
  material,
  onOpenFailed,
}: {
  material: EventMaterial;
  onOpenFailed: (failed: boolean) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const action = materialAction(material);
  const meta = materialMeta(material);
  const text = action.kind === 'text';
  // ссылка и файл — описание в две строки; текстовый материал раскрывается нажатием
  const lines = text && expanded ? undefined : 2;

  const press = () => {
    if (action.kind === 'text') {
      setExpanded((value) => !value);
      return;
    }
    // синхронно в обработчике нажатия (web: `window.open` / `<a download>` до любого `await`)
    onOpenFailed(false);
    const open = action.kind === 'file' ? downloadFile(action.url) : openExternalUrl(action.url);
    open.catch(() => onOpenFailed(true));
  };
  const hint =
    action.kind === 'file'
      ? t('tickets.materials.download')
      : action.kind === 'link'
        ? t('tickets.materials.openLink')
        : expanded
          ? t('tickets.materials.collapse')
          : t('tickets.materials.expand');
  // строка без описания у текстового материала не раскрывается — нажимать нечего
  const pressable = !text || material.description !== null;

  return (
    <Pressable
      testID={`event-material-${material.id}`}
      accessibilityRole={action.kind === 'link' ? 'link' : 'button'}
      // скринридер читает строку целиком: описание — полностью (на экране — до двух строк)
      accessibilityLabel={[material.title, material.description, meta].filter(Boolean).join('. ')}
      accessibilityHint={pressable ? hint : undefined}
      accessibilityState={text && pressable ? { expanded } : undefined}
      disabled={!pressable}
      onPress={press}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <View
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name={materialIcon(material.type)} size={size.icon} color={theme.text.secondary} />
      </View>
      <View style={styles.main}>
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{material.title}</Text>
        {material.description ? (
          <Text numberOfLines={lines} style={[textStyle('body'), { color: theme.text.secondary }]}>
            {material.description}
          </Text>
        ) : null}
        {meta ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{meta}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Материалы события (event-tickets PR C, plan-C §7): строки по порядку сервера — иконка темы, название, описание (до
 * двух строк), «PDF · 1,2 МБ» или домен ссылки. Нажатие: ссылка — системный браузер (`openExternalUrl`), PDF —
 * скачивание (`downloadFile`), текст — раскрытие описания. Пусто — блока нет. Ошибка открытия — баннер под списком.
 * Чистое представление: данные — ответ публичного списка или `TicketView.materials` (и офлайн-копия билета);
 * `notice` — баннер над списком (ошибка обновления при показанных данных): с ним секция видна и при пустом списке —
 * иначе ошибка и «Повторить» пропали бы вместе с блоком.
 */
export function EventMaterials({
  materials,
  notice = null,
}: {
  materials: readonly EventMaterial[];
  notice?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (materials.length === 0 && notice === null) return null;
  return (
    <EventMaterialsSection>
      {notice}
      {materials.length > 0 ? (
        <View>
          {materials.map((material) => (
            <MaterialRow key={material.id} material={material} onOpenFailed={setFailed} />
          ))}
        </View>
      ) : null}
      {failed ? <Banner tone="warning" message={t('tickets.materials.openFailed')} /> : null}
    </EventMaterialsSection>
  );
}

/** Строк в скелетоне блока: у события обычно 1–3 материала. */
const SKELETON_ROWS = 2;

/**
 * Скелетон первой загрузки: строки той же раскладки, что `MaterialRow` (место иконки, название, описание, подпись),
 * под заголовком «Материалы».
 */
export function EventMaterialsSkeleton() {
  const theme = useTheme();
  return (
    <View testID="event-materials-skeleton">
      <SkeletonGroup>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View
            key={index}
            testID="event-material-skeleton-row"
            style={[styles.row, { borderTopColor: theme.border.subtle }]}
          >
            <View style={styles.icon}>
              <Skeleton width={size.icon} height={size.icon} />
            </View>
            <View style={styles.main}>
              <SkeletonText variant="titleSm" lines={1} lastLineWidth="60%" />
              <SkeletonText variant="body" lines={2} lastLineWidth="80%" />
              <SkeletonText variant="meta" lines={1} lastLineWidth="30%" />
            </View>
          </View>
        ))}
      </SkeletonGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.s3 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s3,
    minHeight: size.rowMin,
    paddingVertical: space.s3,
    borderTopWidth: stroke.hairline,
  },
  icon: { paddingTop: space.s1 },
  main: { flex: 1, gap: space.s1 },
});
