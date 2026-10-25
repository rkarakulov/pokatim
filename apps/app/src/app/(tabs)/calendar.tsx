import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SectionHeader, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { CalendarFeed } from '@/features/calendar/calendar-feed';
import { NO_FILTERS, type CalendarFilters } from '@/features/calendar/filters';

const DOCUMENT_TITLE = `${t('calendar.title')} — ${t('app.name')}`;

/**
 * Вкладка «Календарь» (блок 04): реальные массовые старты с сегодняшнего дня по Минску — фильтры «Дата» /
 * «Дисциплина» / «Город», герой «Ближайший старт», список по месяцам, курсорная подгрузка. Только для вошедших (как
 * все вкладки); карточка старта — публичный маршрут `/calendar/<id>`. Медиа, комментарии, кросс-ссылки скрыты (§4).
 * Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export default function CalendarScreen() {
  const theme = useTheme();
  const [filters, setFilters] = useState<CalendarFilters>(NO_FILTERS);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <CalendarFeed
        filters={filters}
        onFiltersChange={setFilters}
        header={
          <View style={styles.head}>
            <SectionHeader kicker={t('calendar.kicker')} title={t('calendar.title')} />
            <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
              {t('calendar.lead')}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  head: { gap: space.s2 },
});
