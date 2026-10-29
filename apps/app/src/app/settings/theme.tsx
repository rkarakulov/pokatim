import { APP_THEME_IDS, type AppThemeId } from '@pokatim/contracts';
import { isNetworkError } from '@pokatim/api-client';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { ThemePreview } from '@/features/appearance/theme-preview';
import { useSetTheme } from '@/features/appearance/theme-mutation';
import { toAppThemeId } from '@/features/appearance/theme-id';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { useProfile } from '@/features/profile/queries';
import { SettingsRow } from '@/features/settings/settings-row';

const DOCUMENT_TITLE = `${t('settings.theme')} — ${t('app.name')}`;

/** Баннер ошибки сохранения: сеть — «Нет соединения», прочее (5xx, 429) — «Не удалось сохранить тему» (RC-6). */
const saveErrorMessage = (error: unknown) =>
  isNetworkError(error) ? t('auth.error.network') : t('settings.theme.saveFailed');

/**
 * «Тема» (user-theme, ADR-0021; вход — строка «Тема» в «Настройках»): 7 тем приложения с превью, названием и
 * описанием, выбранная — отметка (радиогруппа). Выбор — из профиля (`['profile']`): первая загрузка — скелетон,
 * ошибка — «Нет соединения» / «Не удалось загрузить» с повтором. Нажатие перекрашивает приложение сразу (оптимистично)
 * и сохраняет тему в аккаунте (`PUT /v1/profile/theme`); ошибка — баннер, тема возвращается. Гард и оболочка —
 * `useSettingsShell`.
 */
export default function ThemeScreen() {
  const shell = useSettingsShell();
  return shell ?? <ThemeContent />;
}

function ThemeContent() {
  const theme = useTheme();
  const router = useRouter();
  const profile = useProfile();
  const setTheme = useSetTheme();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  // новый выбор снимает баннер прошлой ошибки (состояние — последней мутации)
  const choose = (id: AppThemeId) => setTheme.mutate(id);

  return (
    <SafeAreaView
      testID="theme-screen-root"
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="theme-screen" contentContainerStyle={styles.content}>
        <View style={styles.start}>
          <TextAction label={t('settings.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('settings.theme')}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('settings.theme.lead')}
        </Text>
        {setTheme.isError ? (
          <Banner tone="error" message={saveErrorMessage(setTheme.error)} />
        ) : null}
        <View style={styles.list}>
          <AsyncContent
            query={profile}
            skeleton={
              <View testID="theme-skeleton">
                <SkeletonGroup>
                  {APP_THEME_IDS.map((id) => (
                    <SkeletonListRow key={id} />
                  ))}
                </SkeletonGroup>
              </View>
            }
          >
            {(data) => {
              const current = toAppThemeId(data.themeId);
              return (
                <View testID="theme-list" accessibilityRole="radiogroup">
                  {APP_THEME_IDS.map((id) => (
                    <SettingsRow
                      key={id}
                      label={t(`theme.${id}.name`)}
                      description={t(`theme.${id}.description`)}
                      leading={<ThemePreview themeId={id} />}
                      selected={id === current}
                      onPress={() => choose(id)}
                    />
                  ))}
                </View>
              );
            }}
          </AsyncContent>
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
