import { useTheme, UiKit } from '@rkarakulov/ui';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotFoundScreen } from '@/components/not-found-screen';

import photo from '../../assets/images/icon.png';

/** Витрина компонентов базы — только в dev-сборке; в production маршрута как бы нет: «Страница не найдена». */
export default function UiKitScreen() {
  const theme = useTheme();
  if (!__DEV__) return <NotFoundScreen />;
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface.default }]}>
      <UiKit photo={photo} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safeArea: { flex: 1 } });
