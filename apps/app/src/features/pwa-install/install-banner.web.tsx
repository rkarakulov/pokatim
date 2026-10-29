import { size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, textStyle, useTheme } from '@rkarakulov/ui';
import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { InstallCloseButton } from './install-close-button';
import { INSTALL_HEADER, INSTALL_STEPS } from './install-images';
import { InstallModal, InstallPicture, InstallText, InstallTitle } from './install-modal.web';
import { instructionVariant } from './install-platform';
import {
  bannerVisible,
  closePromo,
  dismissInstallBanner,
  promoVisible,
  PROMO_PARAM,
  promptInstall,
  startInstallPrompt,
  useInstallStore,
} from './install-store.web';

/** Иконка приложения из manifest (`public/icons`). */
const APP_ICON = { uri: '/icons/icon-192.png' };

/**
 * Плашка «Установить приложение» внизу Главной, над вкладками (web/PWA): условия — `install-store.web.ts`, счётчик —
 * `install-prompt-state.ts`. Нажатие: iOS — инструкция (шторка), Chromium — отложенный нативный диалог. До
 * монтирования (SSR, гидрация) — ничего: условия читаются из браузера в эффекте. Промо `?show-pwa-modal` — здесь же.
 */
export function InstallBanner() {
  const theme = useTheme<AppTheme>();
  const banner = useInstallStore(bannerVisible);
  const promo = useInstallStore(promoVisible);
  const ios = useInstallStore((state) => state.ios === true);
  const [instruction, setInstruction] = useState(false);

  // навигация экрана (Главной): `router.setParams` пишет в фокусный маршрут корня, а параметр живёт у `index`
  const navigation = useNavigation<{ setParams: (params: Record<string, undefined>) => void }>();
  useEffect(() => {
    // параметр промо снят и в состоянии навигатора: иначе переход на Главную по вкладке вернёт его в адрес
    if (startInstallPrompt()) navigation.setParams({ [PROMO_PARAM]: undefined });
  }, [navigation]);

  const install = () => {
    if (ios) setInstruction(true);
    else void promptInstall();
  };

  return (
    <>
      {banner ? (
        <View
          testID="pwa-install-banner"
          style={[
            styles.banner,
            { backgroundColor: theme.surface.raised, borderTopColor: theme.border.subtle },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('pwaInstall.banner')}
            onPress={install}
            style={styles.action}
          >
            <Image source={APP_ICON} style={styles.icon} accessibilityElementsHidden />
            <Text
              numberOfLines={1}
              style={[textStyle('label'), styles.link, { color: theme.text.primary }]}
            >
              {t('pwaInstall.banner')}
            </Text>
          </Pressable>
          <InstallCloseButton onPress={dismissInstallBanner} testID="pwa-install-banner-close" />
        </View>
      ) : null}
      {instruction ? <IosInstruction onClose={() => setInstruction(false)} /> : null}
      {/* RN-web `Modal` рендерит портал и закрытым — на SSR портала быть не может: монтируем только открытые окна */}
      {promo && !instruction ? (
        <InstallModal
          placement="dialog"
          title={t('pwaInstall.promo.title')}
          onClose={closePromo}
          testID="pwa-install-promo"
        >
          <InstallPicture image={INSTALL_HEADER} />
          <InstallTitle>{t('pwaInstall.promo.title')}</InstallTitle>
          <InstallText>{t('pwaInstall.promo.text')}</InstallText>
          <Button
            label={t('pwaInstall.promo.install')}
            onPress={() => {
              closePromo();
              install();
            }}
          />
        </InstallModal>
      ) : null}
    </>
  );
}

/** Инструкция iOS (шторка): шаги «Поделиться» и «На экран „Домой“»; картинки — по версии Safari. «×» счётчик не трогает. */
function IosInstruction({ onClose }: { onClose: () => void }) {
  const variant = instructionVariant(navigator.userAgent);
  const steps = INSTALL_STEPS[variant];
  return (
    <InstallModal
      placement="sheet"
      title={t('pwaInstall.ios.title')}
      onClose={onClose}
      testID="pwa-install-ios"
    >
      <InstallPicture image={INSTALL_HEADER} />
      <InstallTitle>{t('pwaInstall.ios.title')}</InstallTitle>
      <InstallText>{t('pwaInstall.ios.step1')}</InstallText>
      <InstallPicture image={steps.share} testID={`pwa-install-share-${variant}`} />
      <InstallText>{t('pwaInstall.ios.step2')}</InstallText>
      <InstallPicture image={steps.addToHome} testID={`pwa-install-home-${variant}`} />
    </InstallModal>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: stroke.hairline,
    paddingLeft: size.gutter,
    paddingRight: space.s2,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: size.touchMin,
    paddingVertical: space.s2,
  },
  icon: { width: size.avatar, height: size.avatar },
  link: { flexShrink: 1, textDecorationLine: 'underline' },
});
