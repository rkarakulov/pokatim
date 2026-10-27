import { Uuid } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { useVerifiedProfile } from '@/features/profile/queries';
import { VerifiedProfileFormView } from '@/features/profile/verified-profile-form';

const DOCUMENT_TITLE = `${t('profile.verified.title')} — ${t('app.name')}`;

/**
 * «Анкета зачёта» (race-results-07; вход — «Профиль» или заявка Verified на карточке гонки): гард и оболочка — как у
 * «Профиля» (`useSettingsShell`). Заголовок — сразу; поля — `AsyncContent` (скелетон, «Нет соединения» / «Не удалось
 * загрузить» с повтором). `?race=<id>` — после сохранения возврат к гонке (заявка Verified продолжается там).
 */
export default function VerifiedProfileScreen() {
  const shell = useSettingsShell();
  return shell ?? <VerifiedProfileContent />;
}

function VerifiedProfileContent() {
  const theme = useTheme();
  const router = useRouter();
  const { race } = useLocalSearchParams<{ race?: string }>();
  const raceId = Uuid.safeParse(race).success ? String(race) : null;
  const view = useVerifiedProfile();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const toRace = raceId ? () => router.dismissTo(`/races/${raceId}`) : null;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView
        testID="verified-profile-screen"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.back}>
          <TextAction
            label={t(toRace ? 'profile.verified.backToRace' : 'profile.verified.back')}
            onPress={toRace ?? back}
          />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('profile.verified.title')}
        </Text>
        <View style={styles.section}>
          <AsyncContent
            query={view}
            skeleton={
              <SkeletonGroup>
                <SkeletonListRow />
                <SkeletonListRow />
                <SkeletonListRow />
              </SkeletonGroup>
            }
          >
            {(data) => <VerifiedProfileFormView view={data} onSaved={toRace ?? undefined} />}
          </AsyncContent>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s3 },
  back: { alignItems: 'flex-start' },
  section: { paddingTop: size.sectionGap },
});
