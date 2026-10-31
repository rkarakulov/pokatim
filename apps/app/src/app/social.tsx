import { useSettingsShell } from '@/features/devices/settings-shell';
import { SocialScreen } from '@/features/social/social-screen';

/**
 * «Свои» (`/social`, P3; вход — «Свои · N» своего профиля). Гард и оболочка — как у `/profile` (`useSettingsShell`):
 * гость — «Регистрация»/«Вход», пока сессия неизвестна — скелетон оболочки.
 */
export default function SocialRoute() {
  const shell = useSettingsShell();
  return shell ?? <SocialScreen />;
}
