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
import { AvatarEditor } from '@/features/profile/avatar-editor';
import { ProfileFormView } from '@/features/profile/profile-form';
import { useProfile } from '@/features/profile/queries';

const DOCUMENT_TITLE = `${t('profile.edit.title')} — ${t('app.name')}`;

/**
 * «Редактировать профиль» (profile-rider-name, rider-profile; вход — со своего профиля `/profile`): фото, публичное
 * имя, клуб и согласие на показ в таблицах результатов. Гард и оболочка — как у «Устройств» (`useSettingsShell`).
 * Заголовок — сразу; фото и поля — `AsyncContent` (скелетон, «Нет соединения» / «Не удалось загрузить» с повтором).
 * Блок «Сезон» переехал в `/profile`.
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
          {t('profile.edit.title')}
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
            {(data) => (
              <View style={styles.form}>
                {/* фото — своя мутация, вне формы имени и клуба */}
                <AvatarEditor avatarId={data.avatar?.id ?? null} />
                <ProfileFormView profile={data} />
              </View>
            )}
          </AsyncContent>
        </View>
        {/* анкета зачёта Verified (race-results-07): сразу — не ждёт данных профиля */}
        <View style={[styles.section, styles.back]}>
          <TextAction
            label={t('profile.verified.link')}
            onPress={() => router.push('/settings/verified')}
          />
        </View>
        {/* настройки уведомлений (N4): сразу — не ждёт данных профиля */}
        <View style={[styles.section, styles.back]}>
          <TextAction
            label={t('profile.notifications')}
            onPress={() => router.push('/settings/notifications')}
          />
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
  form: { gap: size.sectionGap },
});
