import { t } from '@pokatim/i18n';
import { Button, TextAction } from '@rkarakulov/ui';
import { useState } from 'react';

import { DocumentTitle } from '@/components/document-title';
import { AuthActions, AuthScreen } from '@/features/auth/auth-screen';
import { requestLocationPermission } from '@/features/location/location-permission';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';

const DOCUMENT_TITLE = `${t('location.title')} — ${t('app.name')}`;

/**
 * Pre-permission геопозиции (`pokatim-app.md`): объяснение до системного диалога. «Разрешить» — системный запрос, при
 * любом исходе — Главная; «Не сейчас» — Главная без запроса. Экран — один раз на устройство (флаг устройства).
 * Координаты не запрашиваются и не читаются (Q6).
 */
export default function LocationScreen() {
  const [requesting, setRequesting] = useState(false);

  const allow = async () => {
    setRequesting(true);
    // ошибка запроса — как «недоступно»: шаг всё равно пройден (функция не бросает)
    await requestLocationPermission();
    await useOnboardingStore.getState().finishLocation('requested');
  };
  const notNow = () => void useOnboardingStore.getState().finishLocation('dismissed');

  return (
    <AuthScreen
      kicker={t('onboarding.kicker')}
      title={t('location.title')}
      lead={t('location.lead')}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <AuthActions>
        <Button label={t('location.allow')} onPress={() => void allow()} loading={requesting} />
        <TextAction label={t('location.notNow')} onPress={notNow} disabled={requesting} />
      </AuthActions>
    </AuthScreen>
  );
}
