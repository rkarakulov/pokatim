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
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { ProfileFormView } from '@/features/profile/profile-form';
import { useProfile } from '@/features/profile/queries';

const DOCUMENT_TITLE = `${t('profile.title')} — ${t('app.name')}`;

/**
 * «Профиль» (profile-rider-name; вход — иконка верхней панели Главной): публичное имя и согласие на показ в таблицах
 * результатов. Гард и оболочка — как у «Устройств» (`useSettingsShell`). Заголовок — сразу; поля — `AsyncContent`
 * (скелетон, «Нет соединения» / «Не удалось загрузить» с повтором).
 */
export default function ProfileScreen() {
  const shell = useSettingsShell();
  return shell ?? <ProfileContent />;
}

function ProfileContent() {
  const theme = useTheme();
  const router = useRouter();
  const profile = useProfile();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView
        testID="profile-screen"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.back}>
          <TextAction label={t('profile.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('profile.title')}
        </Text>
        <View style={styles.section}>
          <AsyncContent
            query={profile}
            skeleton={
              <SkeletonGroup>
                <SkeletonListRow />
                <SkeletonListRow />
              </SkeletonGroup>
            }
          >
            {(data) => <ProfileFormView profile={data} />}
          </AsyncContent>
        </View>
        {/* удаление аккаунта (A2): внизу экрана, сразу — не ждёт данных профиля */}
        <View style={[styles.section, styles.back]}>
          <TextAction
            label={t('profile.deleteAccount')}
            destructive
            onPress={() => router.push('/settings/account/delete')}
          />
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
