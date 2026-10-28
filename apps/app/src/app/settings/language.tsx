import { size, space } from '@pokatim/design-tokens';
import { i18n, localeNames, t } from '@pokatim/i18n';
import { TextAction, textStyle, useLocale, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { saveLocale } from '@/features/settings/locale-preference';
import { SettingsRow } from '@/features/settings/settings-row';

const DOCUMENT_TITLE = `${t('settings.language')} — ${t('app.name')}`;

/**
 * «Язык» (settings-hub): языки интерфейса из сборки (`i18n.locales`), имя — на самом языке; выбранный — галочка.
 * Выбор применяется сразу и сохраняется на устройстве (`locale-preference`), в профиле поля языка нет.
 */
export default function LanguageScreen() {
  const shell = useSettingsShell();
  return shell ?? <LanguageContent />;
}

function LanguageContent() {
  const theme = useTheme();
  const router = useRouter();
  // подписка на смену языка: галочка переезжает без перезахода
  const current = useLocale();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="language-screen" contentContainerStyle={styles.content}>
        <View style={styles.start}>
          <TextAction label={t('settings.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('settings.language')}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('settings.language.lead')}
        </Text>
        <View testID="language-list" accessibilityRole="radiogroup" style={styles.list}>
          {i18n.locales.map((locale) => (
            <SettingsRow
              key={locale}
              label={localeNames[locale] ?? locale}
              selected={locale === current}
              onPress={() => void saveLocale(locale)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s3 },
  start: { alignItems: 'flex-start' },
  list: { paddingTop: size.sectionGap },
});
