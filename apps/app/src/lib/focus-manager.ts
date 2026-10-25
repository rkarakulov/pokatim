import { focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

/**
 * В RN нет `visibilitychange`: без AppState focusManager не узнаёт о возврате приложения из фона, и
 * `refetchOnWindowFocus` не срабатывает (R7 блока 02). Активно — в фокусе, фон и `inactive` — нет.
 */
export function connectFocusManager() {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status) =>
      setFocused(status === 'active'),
    );
    return () => subscription.remove();
  });
}
