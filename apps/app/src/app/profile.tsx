import { useSettingsShell } from '@/features/devices/settings-shell';
import { OwnProfileScreen } from '@/features/profile/own-profile-screen';

/**
 * Свой профиль райдера (`/profile`, rider-profile; вход — аватар верхней панели Главной). Гард и оболочка — как у
 * «Настроек» (`useSettingsShell`): гость — «Регистрация»/«Вход», пока сессия неизвестна — скелетон оболочки.
 */
export default function OwnProfileRoute() {
  const shell = useSettingsShell();
  return shell ?? <OwnProfileScreen />;
}
