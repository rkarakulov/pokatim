import type { RouteRideSection } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Kicker, Pill, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { routeRideSectionsSummary, routeRideSectionView } from './route-ride-format';

/** Строка участка: заголовок, время или статус, «Лучший», сравнение; без нажатия — один элемент скринридера. */
function SectionRow({ section, index }: { section: RouteRideSection; index: number }) {
  const theme = useTheme();
  const view = routeRideSectionView(section, index);
  const secondary = { color: theme.text.secondary };
  return (
    <View
      accessible
      accessibilityLabel={view.a11y}
      testID={`route-ride-section-${index + 1}`}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <Text style={[textStyle('label'), { color: theme.text.primary }]}>{view.title}</Text>
      <View style={styles.line}>
        {view.time !== null ? (
          <Text style={[textStyle('time'), { color: theme.text.primary }]}>{view.time}</Text>
        ) : (
          <Text style={[textStyle('body'), secondary]}>{view.status}</Text>
        )}
        {view.best ? <Pill label={t('races.attempt.best')} tone="accent" /> : null}
      </View>
      {view.comparison !== null ? (
        <Text style={[textStyle('meta'), secondary]}>{view.comparison}</Text>
      ) : null}
    </View>
  );
}

/**
 * Блок «Участки» результата заезда (route-rides-05 B): сводка «Пройдено N из M», пояснение, строки в порядке ответа.
 * Сумма времён не показывается (края у границ участков не входят ни в один — RC-2), темпа и скорости участка нет;
 * «лучший» и дельта — только сервер. Видимость решает `routeRideSectionsShown` у экрана.
 */
export function RouteRideSections({ sections }: { sections: readonly RouteRideSection[] }) {
  const theme = useTheme();
  return (
    <View testID="route-ride-sections" style={styles.block}>
      <Kicker label={t('routes.rides.result.sections')} />
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {routeRideSectionsSummary(sections)}
      </Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('routes.rides.result.sectionsHint')}
      </Text>
      {sections.map((section, index) => (
        <SectionRow key={`${section.fromM}-${section.toM}`} section={section} index={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  row: { gap: space.s1, paddingTop: space.s3, borderTopWidth: stroke.hairline },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2 },
});
