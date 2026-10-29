import { size, space } from '@pokatim/design-tokens';
import { localeNames, t } from '@pokatim/i18n';
import { Banner, Kicker, TextAction, textStyle, useLocale, useTheme } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { useSignOut } from '@/features/auth/use-sign-out';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { aboutLinks, appVersion } from '@/features/settings/app-info';
import { SettingsRow } from '@/features/settings/settings-row';
import { openExternalUrl } from '@/lib/open-external-url';
import { useAppTheme } from '@/theme/use-app-theme';

const DOCUMENT_TITLE = `${t('settings.title')} — ${t('app.name')}`;

const ACCOUNT_ROWS: readonly { label: () => string; href: Href }[] = [
  { label: () => t('profile.title'), href: '/profile' },
  { label: () => t('settings.verified'), href: '/settings/verified' },
  { label: () => t('devices.title'), href: '/settings/devices' },
  { label: () => t('profile.notifications'), href: '/settings/notifications' },
];

/**
 * «Настройки» (settings-hub; вход — иконка верхней панели Главной): аккаунт (профиль, анкета Verified, устройства,
 * уведомления), тема и язык, о приложении (версия, политика, условия, поддержка — из переменных сборки), «Выйти» и
 * внизу «Удалить аккаунт». Значение строки «Тема» — активная тема приложения (user-theme, ADR-0021). Гард и оболочка —
 * `useSettingsShell`.
 */
export default function SettingsScreen() {
  const shell = useSettingsShell();
  return shell ?? <SettingsContent />;
}

function SettingsContent() {
  const theme = useTheme();
  const router = useRouter();
  const signOut = useSignOut();
  const locale = useLocale();
  const { id: themeId } = useAppTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const { privacy, terms, supportEmail } = aboutLinks();
  const version = appVersion();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // синхронно в обработчике нажатия: web открывает вкладку до любого `await` (блокировщик всплывающих окон)
  const open = (url: string) => {
    setOpenFailed(false);
    openExternalUrl(url).catch(() => setOpenFailed(true));
  };

  const onSignOut = async () => {
    setSigningOut(true);
    // экран уйдёт по гарду; неудачи нет — офлайн выход локальный
    await signOut();
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="settings-screen" contentContainerStyle={styles.content}>
        <View style={styles.start}>
          <TextAction label={t('settings.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('settings.title')}
        </Text>

        <Section title={t('settings.account')}>
          {ACCOUNT_ROWS.map(({ label, href }) => (
            <SettingsRow key={label()} label={label()} onPress={() => router.push(href)} />
          ))}
        </Section>

        <Section title={t('settings.app')}>
          <SettingsRow
            label={t('settings.theme')}
            value={t(`theme.${themeId}.name`)}
            onPress={() => router.push('/settings/theme')}
          />
          <SettingsRow
            label={t('settings.language')}
            value={localeNames[locale] ?? locale}
            onPress={() => router.push('/settings/language')}
          />
        </Section>

        <Section title={t('settings.about')}>
          {version ? <SettingsRow label={t('settings.version')} value={version} /> : null}
          {privacy ? (
            <SettingsRow label={t('settings.privacy')} onPress={() => open(privacy)} />
          ) : null}
          {terms ? <SettingsRow label={t('settings.terms')} onPress={() => open(terms)} /> : null}
          {supportEmail ? (
            <SettingsRow
              label={t('settings.support')}
              value={supportEmail}
              onPress={() => open(`mailto:${supportEmail}`)}
            />
          ) : null}
          {openFailed ? <Banner tone="error" message={t('settings.openFailed')} /> : null}
        </Section>

        <View style={[styles.section, styles.actions]}>
          <TextAction
            label={t('auth.signOut')}
            onPress={() => void onSignOut()}
            disabled={signingOut}
          />
          {/* удаление аккаунта (A2): последним, отдельно от выхода */}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View accessible accessibilityRole="header" accessibilityLabel={title} style={styles.kicker}>
        <Kicker label={title} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s3 },
  start: { alignItems: 'flex-start' },
  section: { paddingTop: size.sectionGap },
  kicker: { paddingBottom: space.s2 },
  actions: { alignItems: 'flex-start', gap: space.s3 },
});
